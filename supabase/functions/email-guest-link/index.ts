// POST JSON { reference_code, token } from the checkout page, right after a guest booking: sends that booking's
// booking_created email with the private #token= link (SPEC §8, RESEARCH M8 "The guest token…"). The token is used
// only in memory to render the link; it is never stored or logged.
//   1. claim_guest_link_email -> check the token against its hash and lease the still-pending booking_created row
//      (at most one email per booking carries the link)
//   2. read the booking's status now: skip it if the booking was cancelled, expired or rejected meanwhile
//   3. send to the outbox row's recipient (never one from the request) and finish_email
// Every refusal is the same 404 not_found, so the endpoint reveals nothing about which references exist.
import { withSupabase } from 'npm:@supabase/server@1'
import { emailAction, emailTransport, fromFor, sendEmail } from '../_shared/email.ts'
import { renderEmail, type BookingStatus, type EmailData } from '../_shared/emailTemplates.ts'
import { returnBase } from '../_shared/paymongo.ts'
import { normalizeReference } from '../_shared/payable.ts'
import { ProofError } from '../_shared/proof.ts'

const json = (body: unknown, status = 200) => Response.json(body, { status })
const notFound = () => json({ code: 'not_found', message: 'Booking not found.' }, 404)

type ClaimedLink = { id: string; booking_id: string; reference_code: string; to_email: string; data: EmailData }

export default {
  fetch: withSupabase({ auth: ['user', 'publishable'] }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ code: 'method_not_allowed', message: 'Use POST.' }, 405)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const mailpitUrl = Deno.env.get('MAILPIT_URL')
    const transport = emailTransport({ transport: Deno.env.get('EMAIL_TRANSPORT'), resendKey, mailpitUrl, supabaseUrl })
    // Use the request's Origin only if it's an allowed site (same rule as the PayMongo return links).
    const site = returnBase(req.headers.get('origin'), Deno.env.get('PUBLIC_SITE_URL'))
    if (transport === 'unavailable' || (transport !== 'disabled' && !site)) {
      // Leave the row pending: the worker sends it later (without the link).
      console.error('email-guest-link: no usable email transport or PUBLIC_SITE_URL', transport)
      return json({ code: 'email_unavailable', message: "We couldn't send the email right now." }, 503)
    }

    let referenceCode: string
    let token: string
    try {
      const input = (await req.json().catch(() => null)) as { reference_code?: unknown; token?: unknown } | null
      referenceCode = normalizeReference(input?.reference_code)
      token = typeof input?.token === 'string' ? input.token.trim() : ''
      if (!token) return notFound()
    } catch (e) {
      if (e instanceof ProofError) return notFound()
      throw e
    }

    const admin = ctx.supabaseAdmin
    const claimed = await admin.rpc('claim_guest_link_email', { p_reference_code: referenceCode, p_token: token })
    if (claimed.error) {
      if (claimed.error.hint === 'not_found') return notFound()
      console.error('email-guest-link: claim failed', claimed.error.message)
      return json({ code: 'server_error', message: 'Something went wrong. Please try again.' }, 500)
    }
    const row = (claimed.data?.[0] ?? null) as ClaimedLink | null
    if (!row) return notFound()

    const finish = async (outcome: 'sent' | 'skipped' | 'failed', error?: string) => {
      const { error: finishError } = await admin.rpc('finish_email', { p_id: row.id, p_outcome: outcome, p_error: error ?? null })
      if (finishError) console.error('email-guest-link: finish_email failed', row.id, finishError.message)
      return json({ status: outcome === 'failed' ? 'queued' : outcome })
    }

    const booking = await admin.from('bookings').select('status, expires_at').eq('id', row.booking_id).maybeSingle()
    if (booking.error || !booking.data) {
      console.error('email-guest-link: booking lookup failed', row.booking_id, booking.error?.message)
      return finish('failed', 'Booking lookup failed.')
    }
    const expired = booking.data.status === 'pending_payment' && booking.data.expires_at && Date.parse(booking.data.expires_at) <= Date.now()
    const status = (expired ? 'expired' : booking.data.status) as BookingStatus

    const next = emailAction(transport, 'booking_created', status)
    if (next.action === 'skip' || transport === 'disabled') return finish('skipped', next.action === 'skip' ? next.reason : undefined)

    const email = renderEmail({ kind: 'booking_created', data: row.data, site: site!, forGuest: true, currentStatus: status, guestToken: token })
    const result = await sendEmail(fetch, transport, { from: fromFor(row.data.venue_name, Deno.env.get('EMAIL_FROM')), resendKey, mailpitUrl }, { to: row.to_email, ...email }, row.id)
    if (result.ok) {
      if (result.note) console.warn('email-guest-link:', row.id, result.note)
      return finish('sent')
    }
    // The worker retries this row later, without the link (it never has the token).
    console.error('email-guest-link: send failed', row.id, result.error)
    return finish('failed', result.error)
  }),
}
