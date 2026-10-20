// POST from pg_cron (private.kick_email_worker, through pg_net) or a local smoke test: sends the due email_outbox rows
// (SPEC §8, RESEARCH M8). The caller proves itself with the x-worker-secret header; the body is ignored.
//   1. claim_email_outbox -> lease a batch (each with the booking's status now)
//   2. drop a booking_created a later event overtook, or every email while the transport is disabled (skipped)
//   3. render from the snapshot and send (a guest's emails never carry the private link here: only email-guest-link
//      has the token), then finish_email -> sent, or failed (retried with backoff, `failed` after 5 attempts)
import { withSupabase } from 'npm:@supabase/server@1'
import { emailAction, emailTransport, sendEmail, workerAuthorized, workerSecret } from '../_shared/email.ts'
import { renderEmail, type BookingStatus, type EmailData, type EmailKind } from '../_shared/emailTemplates.ts'
import { returnBase } from '../_shared/paymongo.ts'

const json = (body: unknown, status = 200) => Response.json(body, { status })
const BATCH = 20
const MAX_BATCHES = 3

type Claimed = {
  id: string
  kind: EmailKind
  to_email: string
  for_guest: boolean
  data: EmailData
  booking_status: BookingStatus
}

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ code: 'method_not_allowed' }, 405)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const secret = workerSecret({ secret: Deno.env.get('EMAIL_WORKER_SECRET'), supabaseUrl })
    // Without a usable secret nobody is authorized; the reason goes to the logs only.
    if (!secret) console.error('send-emails: EMAIL_WORKER_SECRET is missing (or the local one on a deployed project)')
    if (!secret || !workerAuthorized(req.headers.get('x-worker-secret'), secret)) return json({ code: 'unauthorized' }, 401)

    const resendKey = Deno.env.get('RESEND_API_KEY')
    const mailpitUrl = Deno.env.get('MAILPIT_URL')
    const transport = emailTransport({ transport: Deno.env.get('EMAIL_TRANSPORT'), resendKey, mailpitUrl, supabaseUrl })
    const site = returnBase(null, Deno.env.get('PUBLIC_SITE_URL'))
    if (transport === 'unavailable' || (transport !== 'disabled' && !site)) {
      // Nothing is claimed, so the queue waits until the configuration is fixed.
      console.error('send-emails: no usable email transport or PUBLIC_SITE_URL', transport)
      return json({ code: 'email_unavailable' }, 503)
    }

    const admin = ctx.supabaseAdmin
    const counts = { sent: 0, skipped: 0, failed: 0 }
    const finish = async (id: string, outcome: 'sent' | 'skipped' | 'failed', error?: string) => {
      const { error: finishError } = await admin.rpc('finish_email', { p_id: id, p_outcome: outcome, p_error: error ?? null })
      if (finishError) console.error('send-emails: finish_email failed', id, finishError.message)
      counts[outcome]++
    }

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const { data, error } = await admin.rpc('claim_email_outbox', { p_limit: BATCH })
      if (error) {
        console.error('send-emails: claim failed', error.message)
        return json({ code: 'server_error', ...counts }, 500)
      }
      const rows = (data ?? []) as Claimed[]
      for (const row of rows) {
        const next = emailAction(transport, row.kind, row.booking_status)
        if (next.action === 'skip' || transport === 'disabled') {
          await finish(row.id, 'skipped', next.action === 'skip' ? next.reason : undefined)
          continue
        }
        const email = renderEmail({ kind: row.kind, data: row.data, site: site!, forGuest: row.for_guest, currentStatus: row.booking_status })
        const result = await sendEmail(fetch, transport, { from: Deno.env.get('EMAIL_FROM'), resendKey, mailpitUrl }, { to: row.to_email, ...email }, row.id)
        if (result.ok) {
          if (result.note) console.warn('send-emails:', row.id, result.note)
          await finish(row.id, 'sent')
        } else {
          console.error('send-emails: send failed', row.id, result.error)
          await finish(row.id, 'failed', result.error)
        }
      }
      if (rows.length < BATCH) break
    }

    return json({ transport, ...counts })
  }),
}
