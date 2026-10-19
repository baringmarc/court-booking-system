// POST JSON { reference_code, token? } -> { checkout_url }. Starts (or resumes) a PayMongo test-mode checkout for a
// booking that is waiting for payment. Guests authenticate with the private booking token; signed-in players with
// their session. The amount always comes from the database (RESEARCH "Milestone 7", SPEC §4).
//   1. proof_target                 -> authorize and check the booking is payable (same rules as proof upload)
//   2. paymongo_checkout_for        -> reuse the booking's stored, still usable session
//   3. create a session at PayMongo with the test key (or a fake one with PAYMONGO_MODE=stub on the local stack)
//   4. record_paymongo_checkout     -> store it; if another request stored one first, return that one
import { withSupabase } from 'npm:@supabase/server@1'
import { ProofError } from '../_shared/proof.ts'
import { callerUserId, normalizeReference, rpcError } from '../_shared/payable.ts'
import {
  checkAmountPayable,
  checkoutMode,
  checkoutRequestBody,
  PAYMONGO_API,
  parseCheckoutResponse,
  returnBase,
  stubCheckoutSession,
  toCentavos,
  type CheckoutSession,
} from '../_shared/paymongo.ts'

const unavailable = () => new ProofError('payments_unavailable', "Online payment isn't available right now. Please upload a proof instead.", 503)

async function createSession(body: unknown): Promise<CheckoutSession> {
  const key = Deno.env.get('PAYMONGO_SECRET_KEY')
  const mode = checkoutMode({ secretKey: key, mode: Deno.env.get('PAYMONGO_MODE'), supabaseUrl: Deno.env.get('SUPABASE_URL') })
  if (mode === 'stub') return stubCheckoutSession(crypto.randomUUID().replaceAll('-', ''))
  if (mode === 'unavailable') {
    // No test key (a live key counts as none: SPEC keeps PayMongo in test mode), and no local stub.
    console.error('create-paymongo-checkout: no PayMongo test key, and stub mode is off or not local')
    throw unavailable()
  }
  const res = await fetch(PAYMONGO_API, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${key!}:`)}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    // PayMongo's error details are for our logs only (their best practices); the client gets a generic message.
    console.error('PayMongo checkout failed', res.status, JSON.stringify(json?.errors ?? null))
    throw new ProofError('payments_failed', "We couldn't start the online payment. Please try again or upload a proof.", 502)
  }
  return parseCheckoutResponse(json)
}

export default {
  fetch: withSupabase({ auth: ['user', 'publishable'] }, async (req, ctx) => {
    if (req.method !== 'POST') {
      return Response.json({ code: 'method_not_allowed', message: 'Use POST.' }, { status: 405 })
    }
    try {
      const input = (await req.json().catch(() => null)) as { reference_code?: unknown; token?: unknown } | null
      const referenceCode = normalizeReference(input?.reference_code)
      const token = typeof input?.token === 'string' && input.token.trim() ? input.token.trim() : null
      const admin = ctx.supabaseAdmin

      const target = await admin.rpc('proof_target', {
        p_reference_code: referenceCode,
        p_token: token,
        p_user_id: callerUserId(ctx),
      })
      if (target.error) throw rpcError(target.error)
      const booking = target.data?.[0] as { booking_id: string; total_amount: number } | undefined
      if (!booking) throw new ProofError('not_found', 'Booking not found.', 404)

      const amountCentavos = toCentavos(booking.total_amount)
      checkAmountPayable(amountCentavos)

      const existing = await admin.rpc('paymongo_checkout_for', { p_booking_id: booking.booking_id })
      if (existing.error) throw rpcError(existing.error)
      if (existing.data?.[0]) return Response.json({ checkout_url: existing.data[0].checkout_url })

      const base = returnBase(req.headers.get('origin'), Deno.env.get('PUBLIC_SITE_URL'))
      if (!base) {
        console.error('create-paymongo-checkout: PUBLIC_SITE_URL is not set')
        throw unavailable()
      }
      const session = await createSession(checkoutRequestBody({ bookingId: booking.booking_id, referenceCode, amountCentavos, base }))

      const stored = await admin.rpc('record_paymongo_checkout', {
        p_booking_id: booking.booking_id,
        p_checkout_id: session.id,
        p_checkout_url: session.checkoutUrl,
        p_amount_centavos: amountCentavos,
      })
      if (stored.error) throw rpcError(stored.error)
      return Response.json({ checkout_url: stored.data?.[0]?.checkout_url ?? session.checkoutUrl })
    } catch (e) {
      if (e instanceof ProofError) {
        return Response.json({ code: e.code, message: e.message }, { status: e.status })
      }
      console.error('create-paymongo-checkout failed', e instanceof Error ? e.message : e)
      return Response.json({ code: 'server_error', message: 'Something went wrong. Please try again.' }, { status: 500 })
    }
  }),
}
