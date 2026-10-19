// PayMongo (test mode) helpers for the payment Edge Functions (RESEARCH "Milestone 7"). Plain TypeScript with no
// Deno APIs, so Vitest and tsc check it with the app.
import { ProofError } from './proof.ts'

export const PAYMONGO_API = 'https://api.paymongo.com/v2/checkout_sessions'
/** Methods offered on the hosted checkout (the user's choice in T7.1; must be enabled on the account, see T7.7). */
export const PAYMONGO_METHODS = ['gcash', 'paymaya', 'card', 'qrph'] as const
/** Assumed PayMongo minimum (PHP 20); to confirm against the test account in T7.7. */
export const MIN_CHECKOUT_CENTAVOS = 2000
/** Host of the fake checkout page in stub mode (local only; Playwright intercepts it). */
export const STUB_CHECKOUT_HOST = 'checkout.paymongo.test'

/** PHP amount (numeric(10,2) from the database) to integer centavos. */
export function toCentavos(amount: number | string): number {
  const value = Number(amount)
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid amount: ${amount}`)
  return Math.round(value * 100)
}

/** Only test keys are accepted: SPEC keeps PayMongo in test mode, so a live key is a configuration error. */
export function isTestSecretKey(key: string | undefined | null): key is string {
  return typeof key === 'string' && key.startsWith('sk_test_')
}

/**
 * Base URL for the success and cancel links. Never taken from free client input (open redirect): the request's
 * Origin is used only when it's in the configured allow-list, otherwise the first configured site.
 */
export function returnBase(origin: string | null, allowList: string | undefined): string | null {
  const sites = (allowList ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => /^https?:\/\/[^\s/]+$/.test(s))
  if (sites.length === 0) return null
  const normalized = origin?.replace(/\/+$/, '') ?? ''
  return sites.includes(normalized) ? normalized : sites[0]
}

export type CheckoutInput = {
  bookingId: string
  referenceCode: string
  amountCentavos: number
  base: string
}

/** Request body for POST /v2/checkout_sessions. The guest token never goes in here (SPEC §4, §6). */
export function checkoutRequestBody({ bookingId, referenceCode, amountCentavos, base }: CheckoutInput) {
  const page = `${base}/booking/${encodeURIComponent(referenceCode)}`
  return {
    data: {
      attributes: {
        line_items: [{ name: `Court booking ${referenceCode}`, amount: amountCentavos, currency: 'PHP', quantity: 1 }],
        payment_method_types: [...PAYMONGO_METHODS],
        success_url: `${page}?paid=1`,
        cancel_url: `${page}?paid=0`,
        reference_number: referenceCode,
        description: `Court booking ${referenceCode}`,
        send_email_receipt: true,
        metadata: { booking_id: bookingId },
      },
    },
  }
}

export type CheckoutSession = { id: string; checkoutUrl: string }

/** Reads the session id and URL from PayMongo's response, refusing anything that doesn't look right. */
export function parseCheckoutResponse(json: unknown): CheckoutSession {
  const data = (json as { data?: { id?: unknown; attributes?: { checkout_url?: unknown } } } | null)?.data
  const id = data?.id
  const url = data?.attributes?.checkout_url
  if (typeof id !== 'string' || !id.startsWith('cs_') || typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Error('Unexpected PayMongo checkout response')
  }
  return { id, checkoutUrl: url }
}

export type CheckoutMode = 'live_api' | 'stub' | 'unavailable'

/**
 * How to create sessions: a test key always means the real (test-mode) API; stub mode needs an explicit
 * PAYMONGO_MODE=stub *and* a local stack (the hosted project's SUPABASE_URL is https, the local one is http).
 */
export function checkoutMode(env: { secretKey?: string | null; mode?: string | null; supabaseUrl?: string | null }): CheckoutMode {
  if (isTestSecretKey(env.secretKey)) return 'live_api'
  if (env.mode === 'stub' && typeof env.supabaseUrl === 'string' && env.supabaseUrl.startsWith('http://')) return 'stub'
  return 'unavailable'
}

/** A fake session for local development (PAYMONGO_MODE=stub). */
export function stubCheckoutSession(randomHex: string): CheckoutSession {
  const id = `cs_stub_${randomHex}`
  return { id, checkoutUrl: `https://${STUB_CHECKOUT_HOST}/stub/${id}` }
}

export function checkAmountPayable(amountCentavos: number) {
  if (amountCentavos < MIN_CHECKOUT_CENTAVOS) {
    throw new ProofError('amount_too_low', 'This booking can\'t be paid online. Please pay with a proof instead.', 422)
  }
}

// --- webhooks (RESEARCH M7 "Webhooks: events, signature, retries, idempotency") -----------------------------

/** The webhook event we act on; everything else is acknowledged and ignored. */
export const PAID_EVENT = 'checkout_session.payment.paid'
/** Local-only webhook secret from supabase/functions/.env.example; refused anywhere but the local stack. */
export const LOCAL_WEBHOOK_SECRET = 'whsk_local_dev_only'

/** Parses `Paymongo-Signature: t=<unix>,te=<test sig>,li=<live sig>`. */
export function parseSignatureHeader(header: string | null | undefined) {
  if (!header) return null
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const i = part.indexOf('=')
      return i < 0 ? [part.trim(), ''] : [part.slice(0, i).trim(), part.slice(i + 1).trim()]
    }),
  )
  if (!/^\d+$/.test(parts.t ?? '')) return null
  return { timestamp: Number(parts.t), test: parts.te ?? '', live: parts.li ?? '' }
}

async function hmacSha256Hex(secret: string, message: string) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Compares in time that doesn't depend on where the strings differ. */
export function constantTimeEqual(a: string, b: string) {
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

/**
 * Verifies a test-mode webhook: HMAC-SHA256 of `${t}.${rawBody}` with the endpoint secret must equal `te`.
 * Live signatures (`li`) are never accepted (SPEC: test mode only).
 */
export async function verifyWebhookSignature(rawBody: string, header: string | null | undefined, secret: string) {
  const parsed = parseSignatureHeader(header)
  if (!parsed || !/^[0-9a-f]{64}$/i.test(parsed.test) || !secret) return false
  const expected = await hmacSha256Hex(secret, `${parsed.timestamp}.${rawBody}`)
  return constantTimeEqual(expected, parsed.test.toLowerCase())
}

/** Builds a valid test-mode signature header (smoke and e2e tests sign fake events with the local secret). */
export async function signWebhookPayload(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},te=${await hmacSha256Hex(secret, `${timestamp}.${rawBody}`)},li=`
}

export type PaidEvent = {
  eventId: string
  checkoutId: string
  paymentId: string
  amountCentavos: number
  currency: string
  source: string | null
  bookingId: string | null
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null)
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

/** Reads the paid payment out of a verified event, or says why the event is ignored. */
export function readPaidEvent(json: unknown): { paid: PaidEvent } | { ignore: string } {
  const event = obj(obj(json)?.data)
  const attrs = obj(event?.attributes)
  if (!event || !attrs) return { ignore: 'malformed' }
  if (attrs.type !== PAID_EVENT) return { ignore: 'event_type' }
  if (attrs.livemode !== false) return { ignore: 'livemode' }

  const session = obj(attrs.data)
  const sessionAttrs = obj(session?.attributes)
  const payments = Array.isArray(sessionAttrs?.payments) ? sessionAttrs.payments : []
  const paid = payments.map(obj).find((p) => obj(p?.attributes)?.status === 'paid')
  const paidAttrs = obj(paid?.attributes)

  const eventId = str(event.id)
  const checkoutId = str(session?.id)
  const paymentId = str(paid?.id)
  const amount = paidAttrs?.amount
  if (!eventId || !checkoutId || !paymentId || typeof amount !== 'number' || !Number.isInteger(amount)) {
    return { ignore: 'no_paid_payment' }
  }
  // Our own metadata always carries a uuid; anything else can't match a booking (and would fail the RPC forever).
  const bookingId = str(obj(sessionAttrs?.metadata)?.booking_id)
  if (bookingId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) {
    return { ignore: 'invalid_metadata' }
  }
  return {
    paid: {
      eventId,
      checkoutId,
      paymentId,
      amountCentavos: amount,
      currency: str(paidAttrs?.currency) ?? '',
      source: str(obj(paidAttrs?.source)?.type),
      bookingId,
    },
  }
}
