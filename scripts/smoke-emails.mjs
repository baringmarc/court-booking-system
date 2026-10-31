// Smoke test for the booking emails (send-emails and email-guest-link Edge Functions) against the LOCAL stack
// (`npx supabase start`), delivering through the local Mailpit (EMAIL_TRANSPORT=mailpit in supabase/functions/.env).
// Run: npm run smoke:emails. Uses the public local-development keys only; never point it at the linked project.
// It creates real local bookings and exits non-zero if any check fails.
import { execSync } from 'node:child_process'
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
const LOCAL_SECRET = env.SECRET_KEY // only to create local test users, promote a test admin and read the outbox
const MAILPIT = env.MAILPIT_URL ?? env.INBUCKET_URL
if (!URL?.startsWith('http://127.0.0.1') || !PUBLISHABLE || !LOCAL_SECRET || !MAILPIT) {
  console.error('Local Supabase stack not running (or not local). Start it with: npx supabase start')
  process.exit(1)
}
const functionsEnv = Object.fromEntries(
  readFileSync('supabase/functions/.env', 'utf8').split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
)
const WORKER_SECRET = functionsEnv.EMAIL_WORKER_SECRET
if (!WORKER_SECRET) throw new Error('EMAIL_WORKER_SECRET missing from supabase/functions/.env (see .env.example)')

const client = () => createClient(URL, PUBLISHABLE, { auth: { persistSession: false } })
const service = createClient(URL, LOCAL_SECRET, { auth: { persistSession: false } })
const stamp = Date.now()

let failures = 0
function check(label, ok, detail) {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(62)} ${detail ?? ''}`)
}

async function signedInUser(email) {
  const password = 'smoke-password-123'
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  const sb = client()
  const { error: signInError } = await sb.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  return { sb, userId: data.user.id }
}

// Any free slot 8–12 days ahead that this run hasn't used yet.
const used = new Set()
async function freeSlot(sb) {
  for (let days = 8; days <= 12; days++) {
    const date = new Date(Date.now() + days * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
    const { data, error } = await sb.rpc('get_availability', { p_date: date, p_venue_slug: 'claudex-courts' })
    if (error) throw error
    const slot = data.find((s) => s.status === 'free' && !used.has(`${s.court_id}|${s.slot_start}`))
    if (slot) {
      used.add(`${slot.court_id}|${slot.slot_start}`)
      return slot
    }
  }
  throw new Error('no free slot 8–12 days ahead')
}

async function guestBooking(email) {
  const sb = client()
  const s = await freeSlot(sb)
  const { data, error } = await sb.rpc('create_booking', {
    p_court_id: s.court_id, p_start: s.slot_start, p_slots: 1, p_guest_name: 'Smoke Email Guest', p_guest_email: email, p_guest_phone: '0917 000 3333',
  })
  if (error) throw error
  return { sb, id: data[0].id, ref: data[0].reference_code, token: data[0].guest_token }
}

async function invoke(sb, name, body, headers) {
  const { data, error } = await sb.functions.invoke(name, { body, headers })
  if (!error) return { status: 200, body: data }
  const res = error.context
  return { status: res?.status, body: res ? await res.json().catch(() => null) : error.message }
}

async function runWorker(secret = WORKER_SECRET) {
  const res = await fetch(`${URL}/functions/v1/send-emails`, { method: 'POST', headers: { 'x-worker-secret': secret } })
  return { status: res.status, body: await res.json().catch(() => null) }
}

async function mails(to) {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
  const { messages } = await res.json()
  return Promise.all(messages.map(async (m) => {
    const full = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()
    return { subject: full.Subject, text: full.Text, html: full.HTML }
  }))
}

async function outbox(bookingId) {
  const { data, error } = await service.from('email_outbox').select('kind, status, attempts, last_error').eq('booking_id', bookingId).order('created_at')
  if (error) throw error
  return data
}

// --- worker auth --------------------------------------------------------------------------------------------
let r = await runWorker('')
check('send-emails: no secret is refused', r.status === 401, `${r.status}`)
r = await runWorker('wrong-secret')
check('send-emails: a wrong secret is refused', r.status === 401, `${r.status}`)

// --- guest: booking_created with the private link -------------------------------------------------------------
const guestEmail = `smoke-email-guest-${stamp}@example.com`
const g = await guestBooking(guestEmail)
r = await invoke(g.sb, 'email-guest-link', { reference_code: g.ref, token: 'wrong-token' })
check('guest link: a wrong token is not found', r.status === 404 && r.body?.code === 'not_found', `${r.status} ${r.body?.code}`)
r = await invoke(g.sb, 'email-guest-link', { reference_code: 'CB-ZZZZZZ', token: g.token })
check('guest link: an unknown reference gives the same answer', r.status === 404 && r.body?.code === 'not_found', `${r.status}`)
r = await invoke(g.sb, 'email-guest-link', { reference_code: g.ref.toLowerCase(), token: g.token })
check('guest link: the right token sends the email', r.status === 200 && r.body?.status === 'sent', `${r.status} ${JSON.stringify(r.body)}`)
r = await invoke(g.sb, 'email-guest-link', { reference_code: g.ref, token: g.token })
check('guest link: a second call sends nothing', r.status === 404, `${r.status}`)
let inbox = await mails(guestEmail)
const created = inbox.find((m) => m.subject === `Booking ${g.ref}: please pay to confirm`)
check('guest inbox: booking_created arrived once', inbox.filter((m) => m.subject.includes('please pay')).length === 1, inbox.map((m) => m.subject).join(' | '))
check('guest inbox: it carries the #token= link', !!created?.text.includes(`/booking/${g.ref}#token=${encodeURIComponent(g.token)}`))
check('outbox: the row is sent and the token is nowhere in it', (await outbox(g.id))[0]?.status === 'sent' &&
  !JSON.stringify((await service.from('email_outbox').select('*').eq('booking_id', g.id)).data).includes(g.token))

// --- player: booking_created, proof_rejected, payment_confirmed through the worker ------------------------------
const { sb: adminSb, userId: adminId } = await signedInUser(`smoke-email-admin-${stamp}@example.com`)
// Admin rights come from venue membership since M12 (T12.10); Claudex Courts is the only venue.
const { data: venue } = await service.from('venues').select('id').eq('slug', 'claudex-courts').single().throwOnError()
await service.from('venue_members').insert({ venue_id: venue.id, user_id: adminId, role: 'staff' }).throwOnError()
const playerEmail = `smoke-email-player-${stamp}@example.com`
const { sb: player } = await signedInUser(playerEmail)
const ps = await freeSlot(player)
const { data: pb, error: pe } = await player.rpc('create_booking', { p_court_id: ps.court_id, p_start: ps.slot_start, p_slots: 1 })
if (pe) throw pe
const pRef = pb[0].reference_code, pId = pb[0].id

r = await runWorker()
check('worker: sends what is due', r.status === 200 && r.body?.transport === 'mailpit' && r.body?.sent >= 1, JSON.stringify(r.body))
inbox = await mails(playerEmail)
const pCreated = inbox.find((m) => m.subject === `Booking ${pRef}: please pay to confirm`)
check("player inbox: booking_created links to the booking page", new RegExp(`/booking/${pRef}\\s`).test(pCreated?.text ?? '') && !pCreated.text.includes('#token='))

const proof = (n) => service.rpc('record_payment_proof', { p_booking_id: pId, p_storage_path: `${pId}/smoke-${n}.png`, p_method: 'gcash', p_amount: 1 })
let { error: proofError } = await proof(1)
if (proofError) throw proofError
let { error: reviewError } = await adminSb.rpc('review_payment', { p_booking_id: pId, p_approve: false, p_note: 'Smoke: blurry screenshot' })
if (reviewError) throw reviewError
;({ error: proofError } = await proof(2))
if (proofError) throw proofError
;({ error: reviewError } = await adminSb.rpc('review_payment', { p_booking_id: pId, p_approve: true }))
if (reviewError) throw reviewError
await runWorker()
inbox = await mails(playerEmail)
const rejected = inbox.find((m) => m.subject === `Booking ${pRef}: please upload a new proof`)
check('player inbox: proof_rejected with the reason', !!rejected?.text.includes('Reason: Smoke: blurry screenshot'))
check('player inbox: payment_confirmed', inbox.some((m) => m.subject === `Booking ${pRef} is confirmed`), inbox.map((m) => m.subject).join(' | '))

// --- guest: cancellation (no link), fallback booking_created (no link), overtaken booking_created (skipped) -----
const { error: cancelError } = await g.sb.rpc('cancel_booking', { p_reference_code: g.ref, p_token: g.token, p_reason: 'Smoke: plans changed' })
if (cancelError) throw cancelError
await runWorker()
inbox = await mails(guestEmail)
const cancelled = inbox.find((m) => m.subject === `Booking ${g.ref} was cancelled`)
check('guest inbox: booking_cancelled, without the link', !!cancelled && !cancelled.text.includes(g.token) && !cancelled.text.includes('/booking/'))

const fallbackEmail = `smoke-email-fallback-${stamp}@example.com`
const f = await guestBooking(fallbackEmail)
await service.from('email_outbox').update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq('booking_id', f.id)
await runWorker()
inbox = await mails(fallbackEmail)
const fallback = inbox.find((m) => m.subject === `Booking ${f.ref}: please pay to confirm`)
check('fallback: booking_created goes out after the wait, without a link', !!fallback && !fallback.text.includes('/booking/') && !fallback.text.includes(f.token))

const overtakenEmail = `smoke-email-overtaken-${stamp}@example.com`
const o = await guestBooking(overtakenEmail)
await o.sb.rpc('cancel_booking', { p_reference_code: o.ref, p_token: o.token })
await service.from('email_outbox').update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq('booking_id', o.id)
await runWorker()
const oRows = await outbox(o.id)
inbox = await mails(overtakenEmail)
check('overtaken: booking_created is skipped, the cancellation is sent',
  oRows.find((x) => x.kind === 'booking_created')?.status === 'skipped' && oRows.find((x) => x.kind === 'booking_cancelled')?.status === 'sent' &&
  inbox.length === 1 && inbox[0].subject === `Booking ${o.ref} was cancelled`, JSON.stringify(oRows.map((x) => [x.kind, x.status])))

// email-guest-link also re-reads the booking: a guest who cancels before the call gets no "please pay" email.
const lateEmail = `smoke-email-late-link-${stamp}@example.com`
const l = await guestBooking(lateEmail)
await l.sb.rpc('cancel_booking', { p_reference_code: l.ref, p_token: l.token })
r = await invoke(l.sb, 'email-guest-link', { reference_code: l.ref, token: l.token })
const lRows = await outbox(l.id)
inbox = await mails(lateEmail)
check('guest link after a cancellation: skipped, nothing sent',
  r.status === 200 && r.body?.status === 'skipped' && lRows.find((x) => x.kind === 'booking_created')?.status === 'skipped' &&
  !inbox.some((m) => m.subject.includes('please pay')), `${r.status} ${JSON.stringify(r.body)} ${inbox.length} mail(s)`)

console.log(failures ? `\n${failures} check(s) failed` : '\nAll email smoke checks passed')
process.exit(failures ? 1 : 0)
