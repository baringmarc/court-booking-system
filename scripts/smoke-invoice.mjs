// Smoke test for the invoice-pdf Edge Function (T26.4) against the LOCAL stack (`npx supabase start`).
// Run: npm run smoke:invoice. Local keys only. It creates tagged venues, users and invoices, sets Plotline's payment
// details aside for the run (and puts them back), then checks: missing payment details refused, a draft's PDF refused to
// its venue admin, a draft sent to every owner (Mailpit has one email with the PDF, the invoice is sent, one
// invoice_sends row), a resend keeps it sent, a paid invoice refused, a venue without owners refused, a venue admin gets
// a sent invoice's PDF and is refused another venue's. Then it removes what it made.
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  execSync('sh scripts/with-docker.sh npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').map((l) => l.match(/^([A-Z_]+)="?([^"]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
)
const URL = env.API_URL
const MAILPIT = env.INBUCKET_URL ?? env.MAILPIT_URL ?? 'http://127.0.0.1:54324'
if (!URL?.startsWith('http://127.0.0.1') || !env.PUBLISHABLE_KEY || !env.SECRET_KEY) {
  console.error('Local Supabase stack not running (or not local). Start it with: npx supabase start')
  process.exit(1)
}
const service = createClient(URL, env.SECRET_KEY, { auth: { persistSession: false } })
const tag = Date.now().toString(36)
let failed = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`); if (!ok) failed++ }
const must = ({ data, error }) => { if (error) throw error; return data }

const users = []
async function signedIn(kind, fullName = null) {
  const email = `e2e-invoice-${kind}-${tag}@example.com`
  const password = 'smoke-password-123'
  const { user } = must(await service.auth.admin.createUser({ email, password, email_confirm: true }))
  users.push(user.id)
  if (fullName) must(await service.from('profiles').upsert({ id: user.id, full_name: fullName }))
  const sb = createClient(URL, env.PUBLISHABLE_KEY, { auth: { persistSession: false } })
  const { session } = must(await sb.auth.signInWithPassword({ email, password }))
  return { id: user.id, email, token: session.access_token }
}
async function call(token, body) {
  const r = await fetch(`${URL}/functions/v1/invoice-pdf`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: env.PUBLISHABLE_KEY }, body: JSON.stringify(body),
  })
  const type = r.headers.get('content-type') ?? ''
  if (type.includes('application/pdf')) return { status: r.status, type, bytes: new Uint8Array(await r.arrayBuffer()), disposition: r.headers.get('content-disposition') }
  return { status: r.status, type, body: await r.json().catch(() => null) }
}
const isPdf = (r) => r.status === 200 && r.type.includes('application/pdf') && new TextDecoder().decode(r.bytes.subarray(0, 5)) === '%PDF-'
const statusOf = async (id) => must(await service.from('invoices').select('status').eq('id', id).single()).status
const sendsOf = async (id) => must(await service.from('invoice_sends').select('kind, recipients, sent_by').eq('invoice_id', id).order('created_at'))
async function mailTo(email) {
  const found = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`).then((r) => r.json()).catch(() => null)
  const id = found?.messages?.[0]?.ID
  return id ? fetch(`${MAILPIT}/api/v1/message/${id}`).then((r) => r.json()).catch(() => null) : null
}

const venues = []
async function venue(kind) {
  const slug = `e2e-invoice-${kind}-${tag}`
  const v = must(await service.from('venues').insert({ slug, status: 'active' }).select('id').single())
  venues.push(v.id)
  must(await service.from('venue_settings').insert({ venue_id: v.id, name: `E2E Invoice ${kind} ${tag}`, address: '12 Smoke Street' }))
  return { id: v.id, slug }
}
const invoice = async (venueId, billing_month, extra = {}) =>
  must(await service.from('invoices').insert({ venue_id: venueId, billing_month, ...extra }).select('id').single()).id

// Plotline's payment details are global: keep them aside and put them back afterwards.
const savedAccounts = must(await service.from('platform_payment_accounts').select('*'))
// The table's check wants `<uuid>.png` at the bucket root.
const qrPath = `${randomUUID()}.png`
let qrUploaded = false

try {
  if (savedAccounts.length) must(await service.from('platform_payment_accounts').delete().in('id', savedAccounts.map((a) => a.id)))

  const admin = await signedIn('admin')
  must(await service.from('platform_admins').insert({ user_id: admin.id }))
  const owner1 = await signedIn('owner1', 'Maria Smoke')
  const owner2 = await signedIn('owner2')
  const otherOwner = await signedIn('other')
  const player = await signedIn('player')

  const a = await venue('a')
  const b = await venue('b')
  const c = await venue('c')
  must(await service.from('venue_members').insert([
    { venue_id: a.id, user_id: owner1.id, role: 'owner' },
    { venue_id: a.id, user_id: owner2.id, role: 'owner' },
    { venue_id: b.id, user_id: otherOwner.id, role: 'owner' },
  ]))
  const draft = await invoice(a.id, '2026-01-01')
  const paid = await invoice(a.id, '2025-12-01', { status: 'paid', sent_at: '2026-01-02T00:00:00Z', paid_at: '2026-01-05T00:00:00Z', paid_method: 'GCash', paid_reference: 'SMOKE' })
  const otherSent = await invoice(b.id, '2026-01-01', { status: 'sent', sent_at: '2026-02-02T00:00:00Z' })
  const ownerless = await invoice(c.id, '2026-01-01')

  check('a player is refused', (await call(player.token, { invoice_id: draft, action: 'send' })).status === 403)
  check('a bad body is refused', (await call(admin.token, { invoice_id: 'nope', action: 'send' })).status === 400)

  const missing = await call(admin.token, { invoice_id: draft, action: 'send' })
  check('missing payment details are refused', missing.status === 409 && missing.body?.code === 'billing_details_missing', JSON.stringify(missing.body))
  check('the refused draft is still a draft', (await statusOf(draft)) === 'draft')

  must(await service.storage.from('platform-billing').upload(qrPath, readFileSync('public/brand/plotline-logo.png'), { contentType: 'image/png' }))
  qrUploaded = true
  must(await service.from('platform_payment_accounts').insert({ label: 'GCash', account_name: 'Plotline Smoke', account_number: '0917 000 0000', qr_path: qrPath, position: 0 }))

  const ownerDraftPdf = await call(owner1.token, { invoice_id: draft, action: 'pdf' })
  check("a venue admin can't get a draft's PDF", ownerDraftPdf.status === 403 && ownerDraftPdf.body?.code === 'forbidden', JSON.stringify(ownerDraftPdf.body))
  const preview = await call(admin.token, { invoice_id: draft, action: 'pdf' })
  check('a platform admin previews the draft PDF', isPdf(preview), `${preview.status} ${preview.type}`)

  const sent = await call(admin.token, { invoice_id: draft, action: 'send' })
  const recipients = sent.body?.recipients ?? []
  check('the draft is sent to every owner', sent.status === 200 && sent.body?.ok === true && sent.body?.kind === 'send' && sent.body?.status === 'sent'
    && recipients.length === 2 && recipients.includes(owner1.email) && recipients.includes(owner2.email), JSON.stringify(sent.body))
  check('the invoice is now sent', (await statusOf(draft)) === 'sent')
  const sends1 = await sendsOf(draft)
  check('one invoice_sends row (send) by the admin', sends1.length === 1 && sends1[0].kind === 'send' && sends1[0].sent_by === admin.id, JSON.stringify(sends1))
  const mail = await mailTo(owner1.email)
  const number = `${a.slug.toUpperCase()}-202601`
  check('Mailpit has the invoice email', mail?.Subject === `Invoice ${number} from Plotline`, mail?.Subject ?? 'no message')
  check('one message lists both owners', (mail?.To ?? []).map((t) => t.Address).sort().join() === [owner1.email, owner2.email].sort().join(), JSON.stringify(mail?.To))
  const pdfAttachment = (mail?.Attachments ?? []).find((f) => f.FileName === `${number}.pdf`)
  check('the PDF is attached', pdfAttachment?.ContentType === 'application/pdf', JSON.stringify(mail?.Attachments))
  check('with two owners the email greets the venue', /Dear E2E Invoice a /.test(mail?.Text ?? ''), (mail?.Text ?? '').slice(0, 200))
  check('the email links the venue Reports page', (mail?.Text ?? '').includes(`/admin/reports?invoice=${draft}`))

  const resent = await call(admin.token, { invoice_id: draft, action: 'send' })
  check('a resend keeps it sent', resent.status === 200 && resent.body?.kind === 'resend' && resent.body?.status === 'sent', JSON.stringify(resent.body))
  const sends2 = await sendsOf(draft)
  check('the resend is logged', sends2.length === 2 && sends2[1].kind === 'resend' && (await statusOf(draft)) === 'sent', JSON.stringify(sends2))

  const paidSend = await call(admin.token, { invoice_id: paid, action: 'send' })
  check('a paid invoice is refused', paidSend.status === 409 && paidSend.body?.code === 'invalid_status', JSON.stringify(paidSend.body))
  const noOwner = await call(admin.token, { invoice_id: ownerless, action: 'send' })
  check('a venue without owners is refused', noOwner.status === 409 && noOwner.body?.code === 'no_recipients', JSON.stringify(noOwner.body))
  check('the ownerless draft is still a draft', (await statusOf(ownerless)) === 'draft')

  const ownPdf = await call(owner1.token, { invoice_id: draft, action: 'pdf' })
  check("a venue admin gets their sent invoice's PDF", isPdf(ownPdf) && ownPdf.disposition?.includes(`${number}.pdf`), `${ownPdf.status} ${ownPdf.disposition}`)
  check("a venue admin gets their paid invoice's PDF", isPdf(await call(owner1.token, { invoice_id: paid, action: 'pdf' })))
  const foreign = await call(owner1.token, { invoice_id: otherSent, action: 'pdf' })
  check("a venue admin is refused another venue's invoice", foreign.status === 403, JSON.stringify(foreign.body))
  const sendAsOwner = await call(owner1.token, { invoice_id: otherSent, action: 'send' })
  check('a venue admin cannot send', sendAsOwner.status === 403, JSON.stringify(sendAsOwner.body))
} catch (e) {
  failed++
  console.error('FAIL smoke aborted:', e?.message ?? e)
} finally {
  // invoice_sends → invoices → members, settings → venues; then the run's account and QR, the saved accounts, the users.
  if (venues.length) {
    const ids = must(await service.from('invoices').select('id').in('venue_id', venues)).map((i) => i.id)
    if (ids.length) must(await service.from('invoice_sends').delete().in('invoice_id', ids))
    must(await service.from('invoices').delete().in('venue_id', venues))
    must(await service.from('venue_members').delete().in('venue_id', venues))
    must(await service.from('venue_settings').delete().in('venue_id', venues))
    must(await service.from('venues').delete().in('id', venues))
  }
  must(await service.from('platform_payment_accounts').delete().eq('qr_path', qrPath))
  if (qrUploaded) must(await service.storage.from('platform-billing').remove([qrPath]))
  if (savedAccounts.length) must(await service.from('platform_payment_accounts').insert(savedAccounts))
  must(await service.from('platform_admins').delete().in('user_id', users))
  for (const id of users) await service.auth.admin.deleteUser(id)
  const left = must(await service.from('venues').select('id').in('id', venues.length ? venues : ['00000000-0000-0000-0000-000000000000']))
  check('cleanup removed the tagged venues', left.length === 0, JSON.stringify(left))
}
process.exit(failed ? 1 : 0)
