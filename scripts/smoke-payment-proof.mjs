// Smoke test for the submit-payment-proof Edge Function against the LOCAL stack (`npx supabase start`).
// Run: npm run smoke:proof. Uses the public local-development keys only; never point it at the linked project.
// It creates real local bookings (a guest and a fresh signed-up player) and prints one line per check.
import { execSync } from 'node:child_process'
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
const LOCAL_SECRET = env.SECRET_KEY // used only to create confirmed local test users and promote a test admin
if (!URL?.startsWith('http://127.0.0.1') || !PUBLISHABLE || !LOCAL_SECRET) {
  console.error('Local Supabase stack not running (or not local). Start it with: npx supabase start')
  process.exit(1)
}
const client = () => createClient(URL, PUBLISHABLE, { auth: { persistSession: false } })
const service = createClient(URL, LOCAL_SECRET, { auth: { persistSession: false } })

// Email confirmation is on (as on the hosted project), so create the user already confirmed, then sign in.
async function signedInUser(email) {
  const password = 'smoke-password-123'
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  const sb = client()
  const { error: signInError } = await sb.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  return { sb, userId: data.user.id }
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(1)])
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>')

async function freeSlot(sb, offsetDays, hour) {
  const date = new Date(Date.now() + offsetDays * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
  const { data, error } = await sb.rpc('get_availability', { p_date: date })
  if (error) throw error
  const slot = data.find((s) => s.status === 'free' && new Date(s.slot_start).toLocaleString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', hour12: false }) == hour)
  if (!slot) throw new Error('no free slot')
  return slot
}

async function invoke(sb, fields, bytes, name = 'proof.png', type = 'image/png') {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) if (v != null) form.append(k, String(v))
  form.append('file', new Blob([bytes], { type }), name)
  const { data, error } = await sb.functions.invoke('submit-payment-proof', { body: form })
  if (!error) return { status: 201, body: data }
  const res = error.context
  return { status: res?.status, body: res ? await res.json().catch(() => null) : error.message }
}

const log = (label, r) => console.log(label.padEnd(44), r.status, JSON.stringify(r.body))

// Guest
const guest = client()
const g = await freeSlot(guest, 5, 10)
const { data: gb, error: ge } = await guest.rpc('create_booking', { p_court_id: g.court_id, p_start: g.slot_start, p_slots: 1, p_guest_name: 'Smoke Guest', p_guest_email: 'smoke@example.com', p_guest_phone: '0917 000 1111' })
if (ge) throw ge
const ref = gb[0].reference_code, token = gb[0].guest_token
log('guest: wrong token', await invoke(guest, { reference_code: ref, token: 'nope', method: 'gcash', amount: g.price }, PNG))
log('guest: html disguised as png', await invoke(guest, { reference_code: ref, token, method: 'gcash', amount: g.price }, HTML))
log('guest: valid proof', await invoke(guest, { reference_code: ref, token, method: 'gcash', amount: g.price, reference_number: '1234' }, PNG))
log('guest: second proof while under review', await invoke(guest, { reference_code: ref, token, method: 'gcash', amount: g.price }, PNG))
const { data: gview } = await guest.rpc('get_guest_booking', { p_reference_code: ref, p_token: token })
console.log('guest: booking status / payments'.padEnd(44), gview[0].status, gview[0].payments.length, Object.keys(gview[0].payments[0]).includes('storage_path') ? 'LEAKS PATH' : 'no path')

// Player
const { sb: player } = await signedInUser(`smoke-${Date.now()}@example.com`)
const { data: sess } = await player.auth.getSession()
console.log('player: signed in'.padEnd(44), !!sess.session)
const p = await freeSlot(player, 5, 12)
const { data: pb, error: pe } = await player.rpc('create_booking', { p_court_id: p.court_id, p_start: p.slot_start, p_slots: 1 })
if (pe) throw pe
log('player: proof without token (session only)', await invoke(player, { reference_code: pb[0].reference_code, method: 'maya', amount: 1 }, PNG))
const { data: files } = await player.storage.from('payment-proofs').list(pb[0].id)
console.log('player: can list own proof in storage'.padEnd(44), files?.length ?? 0)
const { data: signed, error: signErr } = await player.storage.from('payment-proofs').createSignedUrl(`${pb[0].id}/${files?.[0]?.name}`, 60)
console.log('player: signed URL for own proof'.padEnd(44), signed?.signedUrl ? 'ok' : signErr?.message)
const { error: upErr } = await player.storage.from('payment-proofs').upload(`${pb[0].id}/direct.png`, new Blob([PNG], { type: 'image/png' }))
console.log('player: direct upload to bucket'.padEnd(44), upErr ? `refused (${upErr.message})` : 'ALLOWED')

// Anonymous caller cannot reach the player's booking
log('anon: player booking without session', await invoke(client(), { reference_code: pb[0].reference_code, method: 'maya', amount: 1 }, PNG))

// Admin review access to the guest's proof (T4.10): an admin can sign it, another player cannot.
const { sb: admin, userId: adminId } = await signedInUser(`smoke-admin-${Date.now()}@example.com`)
const { error: pe2 } = await service.from('profiles').update({ role: 'admin' }).eq('id', adminId)
if (pe2) throw pe2
// Admin rights come from venue membership since M12 (T12.10); Claudex Courts is the only venue.
const { data: venue } = await service.from('venues').select('id').eq('slug', 'claudex-courts').single().throwOnError()
await service.from('venue_members').insert({ venue_id: venue.id, user_id: adminId, role: 'staff' }).throwOnError()
const guestBookingId = gview[0].id
const { data: adminFiles } = await admin.storage.from('payment-proofs').list(guestBookingId)
const guestProofPath = `${guestBookingId}/${adminFiles?.[0]?.name}`
const { data: adminSigned, error: adminSignErr } = await admin.storage.from('payment-proofs').createSignedUrl(guestProofPath, 60)
console.log('admin: signed URL for a guest proof'.padEnd(44), adminSigned?.signedUrl ? 'ok' : adminSignErr?.message)
if (adminSigned?.signedUrl) {
  const res = await fetch(adminSigned.signedUrl)
  console.log('admin: signed URL downloads the file'.padEnd(44), res.status)
}
const { data: otherSigned, error: otherErr } = await player.storage.from('payment-proofs').createSignedUrl(guestProofPath, 60)
console.log('player: signed URL for someone else\'s proof'.padEnd(44), otherSigned?.signedUrl ? 'ALLOWED' : `refused (${otherErr?.message})`)
const { data: reviewed, error: re } = await admin.rpc('review_payment', { p_booking_id: guestBookingId, p_approve: true })
console.log('admin: approve the guest proof'.padEnd(44), re ? re.message : reviewed[0].status)
