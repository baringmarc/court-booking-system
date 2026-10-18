// POST from PayMongo (test mode): records checkout_session.payment.paid events (RESEARCH "Milestone 7", SPEC §4).
//   1. verify Paymongo-Signature over the raw body (te, HMAC-SHA256) before anything else -> 401 if it fails
//   2. acknowledge (2xx) and ignore other event types, live events and events without a paid payment
//   3. record_paymongo_payment with values from the signed payload only; it applies the four cases under a row
//      lock and is idempotent on the PayMongo payment id, so retries and replays are safe
// A database error answers 500 so PayMongo retries (up to 12 times); everything handled answers 200.
import { withSupabase } from 'npm:@supabase/server@1'
import { LOCAL_WEBHOOK_SECRET, parseSignatureHeader, readPaidEvent, verifyWebhookSignature } from '../_shared/paymongo.ts'

const json = (body: unknown, status = 200) => Response.json(body, { status })
// Signatures older than this are logged (retries may reuse the original timestamp, so they aren't refused).
const STALE_SECONDS = 24 * 60 * 60

function webhookSecret() {
  const secret = Deno.env.get('PAYMONGO_WEBHOOK_SECRET') ?? ''
  // The committed local secret must never protect a deployed endpoint (the hosted SUPABASE_URL is https).
  const local = (Deno.env.get('SUPABASE_URL') ?? '').startsWith('http://')
  return secret && (local || secret !== LOCAL_WEBHOOK_SECRET) ? secret : null
}

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ code: 'method_not_allowed' }, 405)

    const secret = webhookSecret()
    if (!secret) {
      console.error('paymongo-webhook: PAYMONGO_WEBHOOK_SECRET is missing (or the local one on a deployed project)')
      return json({ code: 'not_configured' }, 503)
    }

    const raw = await req.text()
    const header = req.headers.get('paymongo-signature')
    if (!(await verifyWebhookSignature(raw, header, secret))) {
      return json({ code: 'invalid_signature' }, 401)
    }
    const t = parseSignatureHeader(header)?.timestamp ?? 0
    if (Date.now() / 1000 - t > STALE_SECONDS) console.warn('paymongo-webhook: old signature timestamp', t)

    let event: unknown
    try {
      event = JSON.parse(raw)
    } catch {
      return json({ received: true, ignored: 'malformed' })
    }
    const read = readPaidEvent(event)
    if ('ignore' in read) return json({ received: true, ignored: read.ignore })

    const { paid } = read
    const { data, error } = await ctx.supabaseAdmin.rpc('record_paymongo_payment', {
      p_checkout_id: paid.checkoutId,
      p_payment_id: paid.paymentId,
      p_event_id: paid.eventId,
      p_amount_centavos: paid.amountCentavos,
      p_currency: paid.currency,
      p_source: paid.source ?? '',
      p_booking_id: paid.bookingId ?? undefined,
    })
    if (error) {
      // Invalid input (our hint, or Postgres 22P02 for a malformed value) can't succeed on a retry; anything else
      // (e.g. the database is down) should be retried.
      if (error.hint === 'invalid_input' || error.code === '22P02') {
        console.error('paymongo-webhook: unusable event', paid.eventId, error.message)
        return json({ received: true, ignored: 'invalid_input' })
      }
      console.error('paymongo-webhook: recording failed', paid.eventId, error.message)
      return json({ code: 'server_error' }, 500)
    }
    const outcome = data?.[0]?.outcome ?? 'unknown'
    if (outcome === 'unknown_checkout' || outcome === 'late') {
      console.warn('paymongo-webhook:', outcome, paid.eventId, paid.checkoutId)
    }
    return json({ received: true, outcome })
  }),
}
