// POST from pg_cron (private.kick_email_worker, through pg_net) or a local smoke test: sends the due email_outbox rows
// (SPEC §8, RESEARCH M8). The caller proves itself with the x-worker-secret header; the body is ignored.
//   1. claim_email_outbox -> lease a batch (each with the booking's status and start now); reminders go last (T30.3)
//   2. drop a booking_created a later event overtook, a booking_reminder whose booking is no longer confirmed, moved or
//      has started, or every email while the transport is disabled (skipped)
//   3. render from the snapshot, attach the .ics where the kind has one (T30.3), and send (a guest's emails never carry
//      the private link here: only email-guest-link has the token), then finish_email -> sent, or failed (retried
//      with backoff, `failed` after 5 attempts)
//   4. Resend's daily or monthly quota (429) -> finish_email deferred for that row and the rest of the batch (pending
//      again after the next UTC midnight, the attempt not spent), and the run stops claiming (T30.3)
import { withSupabase } from 'npm:@supabase/server@1'
import { emailAction, emailTransport, fromFor, sendEmail, sendOrder, workerAuthorized, workerSecret } from '../_shared/email.ts'
import { renderEmail, type BookingStatus, type EmailData, type EmailKind } from '../_shared/emailTemplates.ts'
import { bookingCalendarFile } from '../_shared/calendarFile.ts'
import { venueSiteBase } from '../_shared/venueSite.ts'
import * as Sentry from 'npm:@sentry/deno@10.76.2'
import { withSentry } from '../_shared/sentry.ts'

const json = (body: unknown, status = 200) => Response.json(body, { status })
const BATCH = 20
const MAX_BATCHES = 3

type Claimed = {
  id: string
  booking_id: string
  kind: EmailKind
  to_email: string
  for_guest: boolean
  data: EmailData
  booking_status: BookingStatus
  booking_starts_at: string | null
}

export default {
  fetch: withSupabase({ auth: 'none' }, withSentry('send-emails', async (req, ctx) => {
    if (req.method !== 'POST') return json({ code: 'method_not_allowed' }, 405)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const secret = workerSecret({ secret: Deno.env.get('EMAIL_WORKER_SECRET'), supabaseUrl })
    // Without a usable secret nobody is authorized; the reason goes to the logs only.
    if (!secret) console.error('send-emails: EMAIL_WORKER_SECRET is missing (or the local one on a deployed project)')
    if (!secret || !workerAuthorized(req.headers.get('x-worker-secret'), secret)) return json({ code: 'unauthorized' }, 401)

    const resendKey = Deno.env.get('RESEND_API_KEY')
    const mailpitUrl = Deno.env.get('MAILPIT_URL')
    const transport = emailTransport({ transport: Deno.env.get('EMAIL_TRANSPORT'), resendKey, mailpitUrl, supabaseUrl })
    // Each email links to its booking's own venue site (looked up per row below).
    const siteOptions = { rootDomain: Deno.env.get('PUBLIC_ROOT_DOMAIN'), allowList: Deno.env.get('PUBLIC_SITE_URL') }
    const siteConfigured = Boolean(siteOptions.rootDomain) || venueSiteBase({ slug: null, origin: null, ...siteOptions }) !== null
    if (transport === 'unavailable' || (transport !== 'disabled' && !siteConfigured)) {
      // Nothing is claimed, so the queue waits until the configuration is fixed.
      console.error('send-emails: no usable email transport or site URL', transport)
      return json({ code: 'email_unavailable' }, 503)
    }

    const admin = ctx.supabaseAdmin
    const counts = { sent: 0, skipped: 0, failed: 0, deferred: 0 }
    const finish = async (id: string, outcome: 'sent' | 'skipped' | 'failed' | 'deferred', error?: string) => {
      const { error: finishError } = await admin.rpc('finish_email', { p_id: id, p_outcome: outcome, p_error: error ?? null })
      if (finishError) console.error('send-emails: finish_email failed', id, finishError.message)
      counts[outcome]++
    }

    let quotaError: string | null = null
    for (let batch = 0; batch < MAX_BATCHES && !quotaError; batch++) {
      const { data, error } = await admin.rpc('claim_email_outbox', { p_limit: BATCH })
      if (error) {
        console.error('send-emails: claim failed', error.message)
        return json({ code: 'server_error', ...counts }, 500)
      }
      const rows = (data ?? []) as Claimed[]
      for (const row of sendOrder(rows)) {
        const check = { snapshotStartsAt: row.data.starts_at, bookingStartsAt: row.booking_starts_at, now: new Date() }
        const next = emailAction(transport, row.kind, row.booking_status, check)
        if (next.action === 'skip' || transport === 'disabled') {
          await finish(row.id, 'skipped', next.action === 'skip' ? next.reason : undefined)
          continue
        }
        // Once Resend says the quota is used up, every other send this run would fail the same way.
        if (quotaError) {
          await finish(row.id, 'deferred', quotaError)
          continue
        }
        // A guest's non-final rejection carries a fresh private link. The token lives in memory only; if issuing
        // fails the plain email still goes out (the guest has the original link).
        let guestToken: string | null = null
        if (row.kind === 'proof_rejected' && row.for_guest && !row.data.final) {
          const issued = await admin.rpc('issue_guest_link', { p_booking_id: row.booking_id })
          if (issued.error) console.error('send-emails: issue_guest_link failed', row.id, issued.error.message)
          else guestToken = issued.data
        }
        const venueRow = await admin.from('bookings').select('venues(slug)').eq('id', row.booking_id).maybeSingle()
        const site = venueSiteBase({ slug: venueRow.data?.venues?.slug, origin: null, ...siteOptions })
        if (!site) {
          await finish(row.id, 'failed', 'No site URL for this venue.')
          continue
        }
        const email = renderEmail({ kind: row.kind, data: row.data, site, forGuest: row.for_guest, currentStatus: row.booking_status, guestToken })
        const ics = bookingCalendarFile({ kind: row.kind, data: row.data, bookingId: row.booking_id, now: new Date() })
        const result = await sendEmail(
          fetch,
          transport,
          { from: fromFor(row.data.venue_name, Deno.env.get('EMAIL_FROM')), resendKey, mailpitUrl },
          { to: row.to_email, ...email, ...(ics ? { attachments: [ics] } : {}) },
          row.id,
        )
        if (result.ok) {
          if (result.note) console.warn('send-emails:', row.id, result.note)
          await finish(row.id, 'sent')
        } else if (result.quota) {
          quotaError = `Deferred: Resend's ${result.quota} quota is used up. ${result.error}`
          console.error('send-emails: quota reached, deferring the rest of the run', row.id, result.error)
          await finish(row.id, 'deferred', quotaError)
        } else {
          console.error('send-emails: send failed', row.id, result.error)
          await finish(row.id, 'failed', result.error)
        }
      }
      if (rows.length < BATCH) break
    }

    return json({ transport, ...counts })
  }, Sentry)),
}
