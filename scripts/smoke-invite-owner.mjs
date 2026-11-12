// Smoke test for the invite-venue-owner Edge Function against the LOCAL stack (`npx supabase start`).
// Run: npm run smoke:invite. Local keys only. It creates a tagged venue and users, checks the guard, an invite for a
// new email (arrives in Mailpit and lands on the venue's /admin) and a membership-only run for an existing account,
// a staff invite (T24.1: a staff row, a staff email landing on /admin, and an existing owner never demoted), then
// removes what it made.
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  execSync('sh scripts/with-docker.sh npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').map((l) => l.match(/^([A-Z_]+)="?([^"]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
)
const URL = env.API_URL
if (!URL?.startsWith('http://127.0.0.1') || !env.PUBLISHABLE_KEY || !env.SECRET_KEY) {
  console.error('Local Supabase stack not running (or not local). Start it with: npx supabase start')
  process.exit(1)
}
const service = createClient(URL, env.SECRET_KEY, { auth: { persistSession: false } })
const tag = Date.now().toString(36)
let failed = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`); if (!ok) failed++ }

async function signedIn(email) {
  const password = 'smoke-password-123'
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  const sb = createClient(URL, env.PUBLISHABLE_KEY, { auth: { persistSession: false } })
  const { data: s, error: e2 } = await sb.auth.signInWithPassword({ email, password })
  if (e2) throw e2
  return { id: data.user.id, token: s.session.access_token }
}
const call = (token, body) => fetch(`${URL}/functions/v1/invite-venue-owner`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: env.PUBLISHABLE_KEY }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))

const admin = await signedIn(`e2e-invite-admin-${tag}@example.com`)
const player = await signedIn(`e2e-invite-player-${tag}@example.com`)
await service.from('platform_admins').insert({ user_id: admin.id })
const { data: venue, error: venueError } = await service.from('venues').insert({ slug: `e2e-invite-${tag}`, status: 'draft' }).select('id').single()
if (venueError) throw venueError

try {
  check('a player is refused', (await call(player.token, { venue_id: venue.id, email: 'x@example.com' })).status === 403)
  check('a bad body is refused', (await call(admin.token, { venue_id: 'nope', email: 'x' })).status === 400)
  check('an unknown venue is 404', (await call(admin.token, { venue_id: '00000000-0000-0000-0000-000000000000', email: 'x@example.com' })).status === 404)

  const fresh = `e2e-invitee-${tag}@example.com`
  const r1 = await call(admin.token, { venue_id: venue.id, email: fresh.toUpperCase() })
  check('a new email is invited', r1.status === 200 && r1.body?.invited === true, JSON.stringify(r1))
  const { data: u } = await service.rpc('user_id_by_email', { p_email: fresh })
  const { data: m1 } = await service.from('venue_members').select('role').eq('venue_id', venue.id).eq('user_id', u)
  check('the invitee is an owner', m1?.[0]?.role === 'owner')
  const mail = await fetch(`${env.INBUCKET_URL ?? 'http://127.0.0.1:54324'}/api/v1/search?query=${encodeURIComponent(`to:${fresh}`)}`).then((r) => r.json()).catch(() => null)
  check('the invite email reached Mailpit', (mail?.messages?.length ?? 0) > 0)
  const msgId = mail?.messages?.[0]?.ID
  const full = msgId ? await fetch(`http://127.0.0.1:54324/api/v1/message/${msgId}`).then((r) => r.json()).catch(() => null) : null
  const link = decodeURIComponent(`${full?.HTML ?? ''}${full?.Text ?? ''}`)
  check('the invite link lands on the venue admin', /redirect_to=[^&"\s]*\/admin/.test(link), link.slice(0, 200))

  const r2 = await call(admin.token, { venue_id: venue.id, email: `e2e-invite-player-${tag}@example.com` })
  check('an existing account gets no invite, only the membership', r2.status === 200 && r2.body?.invited === false, JSON.stringify(r2))
  const { data: m2 } = await service.from('venue_members').select('role').eq('venue_id', venue.id).eq('user_id', player.id)
  check('the existing user is an owner', m2?.[0]?.role === 'owner')

  // T24.1: staff invites.
  check('an unknown role is refused', (await call(admin.token, { venue_id: venue.id, email: 'x@example.com', role: 'admin' })).status === 400)
  const staff = `e2e-invite-staff-${tag}@example.com`
  const r3 = await call(admin.token, { venue_id: venue.id, email: staff, role: 'staff' })
  check('a new staff email is invited as staff', r3.status === 200 && r3.body?.invited === true && r3.body?.role === 'staff', JSON.stringify(r3))
  const { data: su } = await service.rpc('user_id_by_email', { p_email: staff })
  const { data: m3 } = await service.from('venue_members').select('role').eq('venue_id', venue.id).eq('user_id', su)
  check('the staff invitee has one staff row', m3?.length === 1 && m3[0].role === 'staff', JSON.stringify(m3))
  const staffMail = await fetch(`${env.INBUCKET_URL ?? 'http://127.0.0.1:54324'}/api/v1/search?query=${encodeURIComponent(`to:${staff}`)}`).then((r) => r.json()).catch(() => null)
  const staffMsg = staffMail?.messages?.[0]
  check('the staff email reached Mailpit and says staff', /staff/i.test(staffMsg?.Subject ?? ''), staffMsg?.Subject ?? 'no message')
  const staffFull = staffMsg?.ID ? await fetch(`http://127.0.0.1:54324/api/v1/message/${staffMsg.ID}`).then((r) => r.json()).catch(() => null) : null
  const staffLink = decodeURIComponent(`${staffFull?.HTML ?? ''}${staffFull?.Text ?? ''}`)
  check('the staff link lands on the venue admin', /redirect_to=[^&"\s]*\/admin/.test(staffLink), staffLink.slice(0, 200))
  check('the staff email has no attachment', (staffFull?.Attachments?.length ?? 0) === 0)

  const r4 = await call(admin.token, { venue_id: venue.id, email: `e2e-invite-player-${tag}@example.com`, role: 'staff' })
  const { data: m4 } = await service.from('venue_members').select('role').eq('venue_id', venue.id).eq('user_id', player.id)
  check('a staff invite never demotes an owner', r4.status === 200 && r4.body?.role === 'owner' && m4?.length === 1 && m4[0].role === 'owner', JSON.stringify({ r4, m4 }))
} finally {
  await service.from('venue_members').delete().eq('venue_id', venue.id)
  await service.from('venues').delete().eq('id', venue.id)
  await service.from('platform_admins').delete().eq('user_id', admin.id)
  for (const id of [admin.id, player.id]) await service.auth.admin.deleteUser(id)
  const { data: u } = await service.rpc('user_id_by_email', { p_email: `e2e-invitee-${tag}@example.com` })
  if (u) await service.auth.admin.deleteUser(u)
  const { data: s } = await service.rpc('user_id_by_email', { p_email: `e2e-invite-staff-${tag}@example.com` })
  if (s) await service.auth.admin.deleteUser(s)
}
process.exit(failed ? 1 : 0)
