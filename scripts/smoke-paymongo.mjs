// Smoke test for the create-paymongo-checkout and paymongo-webhook Edge Functions against the LOCAL stack
// (`npx supabase start`).
// Run: npm run smoke:paymongo. PayMongo is stubbed (PAYMONGO_MODE=stub in supabase/functions/.env) unless a test key
// is configured there. Uses the public local-development keys only; never point it at the linked project.
// It creates real local bookings and exits non-zero if any check fails.
import { execSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Keys come from the running local stack, so nothing key-shaped lives in the repo.
const env = Object.fromEntries(
  execSync('sh scripts/with-docker.sh npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n')
    .map((line) => line.match(/^([A-Z_]+)="?([^"]*)"?$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
)
const URL = env.API_URL
const PUBLISHABLE = env.PUBLISHABLE_KEY
const LOCAL_SECRET = env.SECRET_KEY // only to create a confirmed local test user and read back what was stored
if (!URL?.startsWith('http://127.0.0.1') || !PUBLISHABLE || !LOCAL_SECRET) {
  console.error('Local Supabase stack not running (or not local). Start it with: npx supabase start')
  process.exit(1)
}
const client = () => createClient(URL, PUBLISHABLE, { auth: { persistSession: false } })
const service = createClient(URL, LOCAL_SECRET, { auth: { persistSession: false } })

let failures = 0
function check(label, ok, detail) {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(58)} ${detail ?? ''}`)
}

async function signedInUser(email) {
  const password = 'smoke-password-123'
  const { error } = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  const sb = client()
  const { error: signInError } = await sb.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  return sb
}

async function freeSlot(sb, offsetDays, hour) {
  const date = new Date(Date.now() + offsetDays * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
  const { data, error } = await sb.rpc('get_availability', { p_date: date })
  if (error) throw error
  const slot = data.find((s) => s.status === 'free' && new Date(s.slot_start).toLocaleString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', hour12: false }) == hour)
  if (!slot) throw new Error(`no free slot ${offsetDays} days ahead at ${hour}:00`)
  return slot
}

async function checkout(sb, body) {
  const { data, error } = await sb.functions.invoke('create-paymongo-checkout', { body })
  if (!error) return { status: 200, body: data }
  const res = error.context
  return { status: res?.status, body: res ? await res.json().catch(() => null) : error.message }
}

async function storedCheckout(bookingId) {
  const { data, error } = await service.from('paymongo_checkouts').select('checkout_id, checkout_url, amount_centavos').eq('booking_id', bookingId).maybeSingle()
  if (error) throw error
  return data
}

// Guest
const guest = client()
const g = await freeSlot(guest, 6, 14)
const { data: gb, error: ge } = await guest.rpc('create_booking', { p_court_id: g.court_id, p_start: g.slot_start, p_slots: 1, p_guest_name: 'Smoke PayMongo Guest', p_guest_email: 'smoke-paymongo@example.com', p_guest_phone: '0917 000 2222' })
if (ge) throw ge
const ref = gb[0].reference_code, token = gb[0].guest_token, guestBookingId = gb[0].id

let r = await checkout(guest, { reference_code: ref, token: 'wrong-token' })
check('guest: wrong token is not found', r.status === 404 && r.body?.code === 'not_found', `${r.status} ${r.body?.code}`)
r = await checkout(guest, { reference_code: ref })
check('guest: no token and no session is not found', r.status === 404, `${r.status} ${r.body?.code}`)

// The client can't choose the amount: an `amount` field is ignored and the stored total is charged.
r = await checkout(guest, { reference_code: ref.toLowerCase(), token, amount: 1 })
const firstUrl = r.body?.checkout_url
check('guest: starts a checkout', r.status === 200 && typeof firstUrl === 'string' && firstUrl.startsWith('https://'), `${r.status} ${firstUrl}`)
const stored = await storedCheckout(guestBookingId)
const { data: booking } = await service.from('bookings').select('total_amount').eq('id', guestBookingId).single()
check('amount comes from the database (stored total, in centavos)', stored?.amount_centavos === Math.round(Number(booking.total_amount) * 100),
  `${stored?.amount_centavos} vs total ${booking.total_amount}`)
check('the stored session is the one returned', stored?.checkout_url === firstUrl, stored?.checkout_id)

r = await checkout(guest, { reference_code: ref, token })
check('guest: a second call reuses the same session', r.status === 200 && r.body?.checkout_url === firstUrl, r.body?.checkout_url)

// Player (session only, no token)
const player = await signedInUser(`smoke-paymongo-${Date.now()}@example.com`)
const p = await freeSlot(player, 6, 16)
const { data: pb, error: pe } = await player.rpc('create_booking', { p_court_id: p.court_id, p_start: p.slot_start, p_slots: 1 })
if (pe) throw pe
r = await checkout(player, { reference_code: pb[0].reference_code })
check('player: starts a checkout with their session', r.status === 200 && r.body?.checkout_url?.startsWith('https://'), `${r.status}`)
r = await checkout(client(), { reference_code: pb[0].reference_code })
check("anon: can't start a checkout for a player's booking", r.status === 404, `${r.status} ${r.body?.code}`)

// Unpayable bookings
const { error: ce } = await guest.rpc('cancel_booking', { p_reference_code: ref, p_token: token, p_reason: 'smoke test' })
if (ce) throw ce
r = await checkout(guest, { reference_code: ref, token })
check('cancelled booking: not payable', r.status === 409 && r.body?.code === 'invalid_state', `${r.status} ${r.body?.code}`)

const h = await freeSlot(guest, 6, 18)
const { data: hb, error: he } = await guest.rpc('create_booking', { p_court_id: h.court_id, p_start: h.slot_start, p_slots: 1, p_guest_name: 'Smoke PayMongo Lapsed', p_guest_email: 'smoke-paymongo@example.com', p_guest_phone: '0917 000 2222' })
if (he) throw he
const { error: ue } = await service.from('bookings').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', hb[0].id)
if (ue) throw ue
r = await checkout(guest, { reference_code: hb[0].reference_code, token: hb[0].guest_token })
check('lapsed hold: not payable', r.status === 409 && r.body?.code === 'hold_expired', `${r.status} ${r.body?.code}`)

r = await checkout(guest, { reference_code: 'not-a-ref' })
check('malformed reference: not found', r.status === 404, `${r.status}`)


// --- paymongo-webhook ---------------------------------------------------------------------------------------
// Fake checkout_session.payment.paid events, signed like PayMongo does (HMAC-SHA256 over `t.rawBody`, `te`) with the
// local-only secret from supabase/functions/.env.
const functionsEnv = Object.fromEntries(
  readFileSync('supabase/functions/.env', 'utf8').split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
)
const WEBHOOK_SECRET = functionsEnv.PAYMONGO_WEBHOOK_SECRET
if (!WEBHOOK_SECRET) throw new Error('PAYMONGO_WEBHOOK_SECRET missing from supabase/functions/.env')

const sign = (body, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},te=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')},li=`

function paidEvent({ eventId, checkoutId, paymentId, amount, bookingId, type = 'checkout_session.payment.paid', livemode = false }) {
  return JSON.stringify({ data: { id: eventId, type: 'event', attributes: { type, livemode, created_at: Math.floor(Date.now() / 1000), data: {
    id: checkoutId, type: 'checkout_session', attributes: { metadata: bookingId ? { booking_id: bookingId } : {}, payments: [
      { id: paymentId, type: 'payment', attributes: { amount, currency: 'PHP', status: 'paid', source: { type: 'gcash' } } },
    ] },
  } } } })
}

async function webhook(body, signature) {
  const res = await fetch(`${URL}/functions/v1/paymongo-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(signature ? { 'Paymongo-Signature': signature } : {}) },
    body,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

/** A fresh guest booking with a started checkout: returns its ids, stored session and amount. */
async function bookingWithCheckout(hour) {
  const slot = await freeSlot(guest, 7, hour)
  const { data, error } = await guest.rpc('create_booking', { p_court_id: slot.court_id, p_start: slot.slot_start, p_slots: 1, p_guest_name: 'Smoke PayMongo Webhook', p_guest_email: 'smoke-paymongo@example.com', p_guest_phone: '0917 000 2222' })
  if (error) throw error
  const b = data[0]
  const started = await checkout(guest, { reference_code: b.reference_code, token: b.guest_token })
  if (started.status !== 200) throw new Error(`checkout failed: ${JSON.stringify(started.body)}`)
  const stored = await storedCheckout(b.id)
  return { id: b.id, ref: b.reference_code, token: b.guest_token, checkoutId: stored.checkout_id, amount: stored.amount_centavos }
}

const bookingState = async (id) => {
  const { data: b } = await service.from('bookings').select('status').eq('id', id).single()
  const { data: p } = await service.from('payments').select('method, review_status, review_note, amount').eq('booking_id', id)
  return { status: b.status, payments: p }
}

const stamp = Date.now().toString(36)

// Valid paid event -> confirmed
const paidBooking = await bookingWithCheckout(10)
const paidBody = paidEvent({ eventId: `evt_smoke_${stamp}_1`, checkoutId: paidBooking.checkoutId, paymentId: `pay_smoke_${stamp}_1`, amount: paidBooking.amount, bookingId: paidBooking.id })
r = await webhook(paidBody, sign(paidBody))
let state = await bookingState(paidBooking.id)
check('webhook: a valid paid event confirms the booking', r.status === 200 && r.body?.outcome === 'confirmed' && state.status === 'confirmed',
  `${r.status} ${r.body?.outcome} -> ${state.status}`)
check('webhook: one approved PayMongo payment for the stored total', state.payments.length === 1 && state.payments[0].method === 'paymongo'
  && state.payments[0].review_status === 'approved' && Math.round(Number(state.payments[0].amount) * 100) === paidBooking.amount,
  JSON.stringify(state.payments))

// Replay (PayMongo retries, or someone resends the captured request) -> no duplicate
r = await webhook(paidBody, sign(paidBody))
state = await bookingState(paidBooking.id)
check('webhook: a replay is acknowledged without a second payment', r.status === 200 && r.body?.outcome === 'duplicate' && state.payments.length === 1,
  `${r.status} ${r.body?.outcome}, ${state.payments.length} payment(s)`)

// Bad or missing signature -> 401, nothing changes
const forged = await bookingWithCheckout(12)
const forgedBody = paidEvent({ eventId: `evt_smoke_${stamp}_2`, checkoutId: forged.checkoutId, paymentId: `pay_smoke_${stamp}_2`, amount: forged.amount, bookingId: forged.id })
r = await webhook(forgedBody, sign(forgedBody, 'whsk_wrong_secret'))
state = await bookingState(forged.id)
check('webhook: a bad signature is refused and changes nothing', r.status === 401 && state.status === 'pending_payment' && state.payments.length === 0,
  `${r.status} -> ${state.status}, ${state.payments.length} payment(s)`)
r = await webhook(forgedBody, null)
check('webhook: a missing signature is refused', r.status === 401, `${r.status}`)
r = await webhook(forgedBody.replace(`"amount":${forged.amount}`, '"amount":100'), sign(forgedBody))
state = await bookingState(forged.id)
check('webhook: a body changed after signing is refused', r.status === 401 && state.payments.length === 0, `${r.status}`)

// Late payment: the booking was cancelled before the payment arrived -> recorded for a refund, booking unchanged
const late = await bookingWithCheckout(14)
const { error: lateCancel } = await guest.rpc('cancel_booking', { p_reference_code: late.ref, p_token: late.token, p_reason: 'smoke test' })
if (lateCancel) throw lateCancel
const lateBody = paidEvent({ eventId: `evt_smoke_${stamp}_3`, checkoutId: late.checkoutId, paymentId: `pay_smoke_${stamp}_3`, amount: late.amount, bookingId: late.id })
r = await webhook(lateBody, sign(lateBody))
state = await bookingState(late.id)
check('webhook: a payment after cancellation is late', r.status === 200 && r.body?.outcome === 'late' && state.status === 'cancelled',
  `${r.status} ${r.body?.outcome} -> ${state.status}`)
check('webhook: the late payment is flagged for a refund', state.payments.length === 1 && state.payments[0].review_status === 'rejected'
  && /refund/.test(state.payments[0].review_note ?? ''), state.payments[0]?.review_note)

// Events we don't act on are acknowledged (2xx, so PayMongo doesn't retry) and record nothing
const otherBody = paidEvent({ eventId: `evt_smoke_${stamp}_4`, checkoutId: forged.checkoutId, paymentId: `pay_smoke_${stamp}_4`, amount: forged.amount, type: 'payment.paid' })
r = await webhook(otherBody, sign(otherBody))
check('webhook: other event types are ignored', r.status === 200 && r.body?.ignored === 'event_type', `${r.status} ${JSON.stringify(r.body)}`)
const liveBody = paidEvent({ eventId: `evt_smoke_${stamp}_5`, checkoutId: forged.checkoutId, paymentId: `pay_smoke_${stamp}_5`, amount: forged.amount, livemode: true })
r = await webhook(liveBody, sign(liveBody))
check('webhook: live-mode events are ignored', r.status === 200 && r.body?.ignored === 'livemode', `${r.status} ${JSON.stringify(r.body)}`)
const unknownBody = paidEvent({ eventId: `evt_smoke_${stamp}_6`, checkoutId: `cs_smoke_unknown_${stamp}`, paymentId: `pay_smoke_${stamp}_6`, amount: 50000 })
r = await webhook(unknownBody, sign(unknownBody))
check("webhook: a session we didn't create is ignored", r.status === 200 && r.body?.outcome === 'unknown_checkout', `${r.status} ${r.body?.outcome}`)
state = await bookingState(forged.id)
check('webhook: ignored events recorded nothing', state.status === 'pending_payment' && state.payments.length === 0, `${state.status}`)

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
