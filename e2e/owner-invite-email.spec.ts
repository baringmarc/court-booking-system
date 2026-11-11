// T17.25: the invite-venue-owner function sends the owner email itself for every account state (new, invited without a
// password, existing), attaches the owner manual, and the console shows what was sent. Local stack only.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { axeBothSchemes, createPlatformAdmin, createPlayer, createVenue, deleteVenue, serviceClient, uniqueEmail } from './support/helpers.ts'
import { localSupabase } from './support/local.ts'

const SUPPORT = 'plotline.admin1@gmail.com'
const PDF = 'venue-owner-manual-v1.0.pdf'

type Mail = {
  ID: string
  Subject: string
  Text: string
  HTML: string
  From: { Name: string; Address: string }
  ReplyTo: { Address: string }[]
  Attachments: { FileName: string; ContentType: string }[]
}

const functionsEnv = Object.fromEntries(
  readFileSync('supabase/functions/.env', 'utf8').split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter((m): m is RegExpMatchArray => m !== null).map((m) => [m[1], m[2].trim()]),
)

async function mails(to: string): Promise<Mail[]> {
  const { mailpitUrl } = localSupabase()
  const found = (await (await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json()) as { messages: { ID: string }[] }
  return Promise.all(found.messages.map(async (m) => (await (await fetch(`${mailpitUrl}/api/v1/message/${m.ID}`)).json()) as Mail))
}

async function nextMail(to: string, already = 0): Promise<Mail> {
  let all: Mail[] = []
  await expect.poll(async () => (all = await mails(to)).length, { message: `email to ${to}` }).toBeGreaterThan(already)
  return all.sort((a, b) => a.ID.localeCompare(b.ID))[all.length - 1]
}

// Waits for the message whose subject names the venue, so GoTrue's own (asynchronous) invite email is never picked.
async function mailAbout(to: string, venueName: string): Promise<Mail> {
  let found: Mail | undefined
  await expect
    .poll(async () => (found = (await mails(to)).find((m) => m.Subject.includes(venueName))) !== undefined, { message: `email about ${venueName} to ${to}` })
    .toBe(true)
  return found!
}

async function sessionToken(email: string, password: string) {
  const { url, publishableKey } = localSupabase()
  const client = createClient(url, publishableKey, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.session.access_token
}

async function callAs(token: string, body: unknown) {
  const { url, publishableKey } = localSupabase()
  const res = await fetch(`${url}/functions/v1/invite-venue-owner`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, text, json: JSON.parse(text || 'null') as Record<string, unknown> | null }
}

async function cleanupUser(email: string) {
  const service = serviceClient()
  const { data: userId } = await service.rpc('user_id_by_email', { p_email: email })
  if (userId) {
    await service.from('venue_members').delete().eq('user_id', userId)
    await service.auth.admin.deleteUser(userId)
  }
}

function expectCommonContent(mail: Mail, venueName: string) {
  expect(mail.Subject).toContain(venueName)
  expect(mail.From.Name).toBe('Plotline')
  expect(mail.ReplyTo.map((r) => r.Address)).toEqual([SUPPORT])
  for (const body of [mail.Text, mail.HTML]) {
    expect(body).toContain(venueName)
    expect(body).toContain(SUPPORT)
    expect(body).toContain('https://www.facebook.com/profile.php?id=61595759948011')
    expect(body).toContain('https://m.me/61595759948011')
    expect(body).toContain(PDF)
  }
  if (functionsEnv.OWNER_GUIDE_URL) {
    expect(mail.Attachments.map((a) => a.FileName)).toContain(PDF)
    expect(mail.Attachments.find((a) => a.FileName === PDF)?.ContentType).toMatch(/application\/pdf/)
  }
}

async function memberCount(venueId: string, userId: string) {
  const { data, error } = await serviceClient().from('venue_members').select('user_id').eq('venue_id', venueId).eq('user_id', userId)
  if (error) throw error
  return data.length
}

test('a new account gets the invite email, whose link signs in to the set-password step', async ({ page }) => {
  const venue = await createVenue('owner-mail')
  const admin = await createPlatformAdmin()
  const email = uniqueEmail('owner-new')
  try {
    const res = await callAs(await sessionToken(admin.email, admin.password), { venue_id: venue.id, email })
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ ok: true, invited: true, sent: 'invite' })
    expect(res.text).not.toMatch(/token|access_token|verify\?/i)
    const mail = await nextMail(email)
    expectCommonContent(mail, venue.name)
    const link = mail.Text.match(/https?:\/\/\S+\/auth\/v1\/verify\?\S+/)?.[0]
    expect(link, 'verify link in the invite email').toBeTruthy()
    const redirect = new URL(link!).searchParams.get('redirect_to')!
    expect(redirect.endsWith('/admin')).toBe(true)
    expect(functionsEnv.PUBLIC_SITE_URL.split(',').map((s) => s.trim())).toContain(new URL(redirect).origin)
    expect(mail.Text).not.toMatch(/a day|24 hours/i)

    const url = new URL(link!)
    url.searchParams.set('redirect_to', `${venue.url}/admin`)
    await page.goto(url.toString())
    await expect(page.getByRole('heading', { name: /set your password/i })).toBeVisible()
  } finally {
    await cleanupUser(email)
    await deleteVenue(venue.id)
  }
})

test('an invited account without a password gets a fresh access link email', async () => {
  const venue = await createVenue('owner-mail')
  const admin = await createPlatformAdmin()
  const email = uniqueEmail('owner-link')
  try {
    const invited = await serviceClient().auth.admin.inviteUserByEmail(email)
    if (invited.error) throw invited.error
    const res = await callAs(await sessionToken(admin.email, admin.password), { venue_id: venue.id, email })
    expect(res.json).toEqual({ ok: true, invited: false, sent: 'link' })
    const mail = await mailAbout(email, venue.name)
    expectCommonContent(mail, venue.name)
    expect(mail.Text).toMatch(/https?:\/\/\S+\/auth\/v1\/verify\?\S+/)
  } finally {
    await cleanupUser(email)
    await deleteVenue(venue.id)
  }
})

test('an existing account gets a welcome email with the sign-in link, no token and no password change', async () => {
  const venue = await createVenue('owner-mail')
  const admin = await createPlatformAdmin()
  const owner = await createPlayer('owner-existing')
  try {
    const res = await callAs(await sessionToken(admin.email, admin.password), { venue_id: venue.id, email: owner.email })
    expect(res.json).toEqual({ ok: true, invited: false, sent: 'welcome' })
    const mail = await nextMail(owner.email)
    expectCommonContent(mail, venue.name)
    expect(mail.Text).toContain(`${venue.slug}`)
    expect(mail.Text).toContain('/admin')
    expect(mail.Text).not.toMatch(/auth\/v1\/verify|token/i)
    expect(mail.Text).not.toMatch(/reset|forgot/i)
    // The password still works: nothing was reset.
    await expect(sessionToken(owner.email, owner.password)).resolves.toBeTruthy()
    expect(await memberCount(venue.id, owner.id)).toBe(1)
  } finally {
    await cleanupUser(owner.email)
    await deleteVenue(venue.id)
  }
})

test('a repeated call keeps one owner row for that venue only', async () => {
  const venue = await createVenue('owner-mail')
  const other = await createVenue('owner-other')
  const admin = await createPlatformAdmin()
  const owner = await createPlayer('owner-repeat')
  try {
    const token = await sessionToken(admin.email, admin.password)
    expect((await callAs(token, { venue_id: venue.id, email: owner.email })).status).toBe(200)
    expect((await callAs(token, { venue_id: venue.id, email: owner.email })).status).toBe(200)
    expect(await memberCount(venue.id, owner.id)).toBe(1)
    expect(await memberCount(other.id, owner.id)).toBe(0)
    const { data } = await serviceClient().from('venue_members').select('role').eq('venue_id', venue.id).eq('user_id', owner.id).single()
    expect(data?.role).toBe('owner')
    const { data: members } = await serviceClient().from('venue_members').select('user_id').eq('venue_id', other.id)
    expect(members).toEqual([])
  } finally {
    await cleanupUser(owner.email)
    await deleteVenue(venue.id)
    await deleteVenue(other.id)
  }
})

test('a caller who is not a platform admin gets 403 and no email or membership; an unknown venue gets 404', async () => {
  const venue = await createVenue('owner-mail')
  const admin = await createPlatformAdmin()
  const player = await createPlayer('not-admin')
  const email = uniqueEmail('owner-denied')
  try {
    const denied = await callAs(await sessionToken(player.email, player.password), { venue_id: venue.id, email })
    expect(denied.status).toBe(403)
    expect(denied.json).toMatchObject({ code: 'not_platform_admin' })
    expect(await mails(email)).toEqual([])
    const { data: userId } = await serviceClient().rpc('user_id_by_email', { p_email: email })
    expect(userId).toBeNull()

    const missing = await callAs(await sessionToken(admin.email, admin.password), { venue_id: '00000000-0000-4000-8000-000000000000', email })
    expect(missing.status).toBe(404)
    expect(await mails(email)).toEqual([])
  } finally {
    await cleanupUser(email)
    await deleteVenue(venue.id)
  }
})

async function openVenue(page: Page, venue: { id: string; slug: string; name: string }, admin: { email: string; password: string }) {
  await page.goto(`http://app.localhost:5179/venues?q=${venue.slug}&open=${venue.id}`)
  await page.getByLabel('Email').fill(admin.email)
  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  return page.getByRole('dialog', { name: new RegExp(venue.name) }).or(page.getByRole('region', { name: new RegExp(venue.name) }))
}

test('a platform admin resends from the console: the message names what was sent, and the view is axe clean', async ({ page }) => {
  const venue = await createVenue('owner-mail')
  const admin = await createPlatformAdmin()
  const newEmail = uniqueEmail('owner-ui-new')
  const existing = await createPlayer('owner-ui-existing')
  try {
    const card = await openVenue(page, venue, admin)
    await card.getByRole('button', { name: 'Resend invite' }).click()

    await card.getByLabel('Owner email').fill(newEmail)
    await card.getByRole('button', { name: 'Send invite' }).click()
    await expect(card.getByRole('status')).toHaveText(`An account setup invitation is on its way to ${newEmail}.`)
    await nextMail(newEmail)

    await card.getByLabel('Owner email').fill(existing.email)
    await card.getByRole('button', { name: 'Send invite' }).click()
    await expect(card.getByRole('status')).toHaveText(`A welcome email with the sign-in link is on its way to ${existing.email}.`)
    await expect(card.getByRole('status')).not.toContainText('already has a password')
    await nextMail(existing.email)

    expect(await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBeLessThanOrEqual(0)
    expect(await axeBothSchemes(page)).toEqual([])
  } finally {
    await cleanupUser(newEmail)
    await cleanupUser(existing.email)
    await deleteVenue(venue.id)
  }
})

// T16.6: the owner email lists the next steps, puts the button before the address, and links the address only once the venue is live.
function addressAround(html: string, slug: string) {
  const at = html.indexOf(slug)
  expect(at, 'venue address in html').toBeGreaterThan(-1)
  return at
}

test('a draft venue: the invite email shows the button before the address, which is plain text and goes live on publishing', async () => {
  const venue = await createVenue('owner-mail')
  const admin = await createPlatformAdmin()
  const email = uniqueEmail('owner-draft')
  try {
    const { error } = await serviceClient().from('venues').update({ status: 'draft' }).eq('id', venue.id)
    if (error) throw error
    const res = await callAs(await sessionToken(admin.email, admin.password), { venue_id: venue.id, email })
    expect(res.status).toBe(200)
    const mail = await mailAbout(email, venue.name)
    expectCommonContent(mail, venue.name)
    const link = mail.Text.match(/https?:\/\/\S+\/auth\/v1\/verify\?\S+/)?.[0]
    expect(link, 'verify link in the invite email').toBeTruthy()
    expect(mail.Text).toContain('What happens next')
    expect(mail.HTML).toContain('What happens next')
    expect(mail.Text.indexOf(link!)).toBeLessThan(mail.Text.indexOf(venue.slug, mail.Text.indexOf('What happens next')))
    expect(mail.Text).toMatch(/publish/i)
    expect(mail.HTML).toMatch(/publish/i)
    // The button comes first in the html too; the address is not wrapped in a link.
    expect(mail.HTML.indexOf('/auth/v1/verify')).toBeLessThan(addressAround(mail.HTML.slice(mail.HTML.indexOf('What happens next')), venue.slug) + mail.HTML.indexOf('What happens next'))
    expect(mail.HTML).not.toMatch(new RegExp(`<a [^>]*>\\s*${venue.slug}[^<]*</a>`))
    expect(mail.HTML).not.toMatch(new RegExp(`<a [^>]*href="[^"]*${venue.slug}[^"]*"`))
  } finally {
    await cleanupUser(email)
    await deleteVenue(venue.id)
  }
})

test('an active venue: the invite email links the venue address', async () => {
  const venue = await createVenue('owner-mail')
  const admin = await createPlatformAdmin()
  const email = uniqueEmail('owner-active')
  try {
    const res = await callAs(await sessionToken(admin.email, admin.password), { venue_id: venue.id, email })
    expect(res.status).toBe(200)
    const mail = await mailAbout(email, venue.name)
    // The address host depends on PUBLIC_ROOT_DOMAIN (unset locally: bare slug, link to the site origin), so only the link text is checked.
    const next = mail.HTML.indexOf('What happens next')
    expect(next).toBeGreaterThan(-1)
    expect(mail.HTML.slice(next)).toMatch(new RegExp(`<a [^>]*href="https?://[^"]+"[^>]*>[^<]*${venue.slug}[^<]*</a>`))
    expect(mail.Text.indexOf('What happens next')).toBeGreaterThan(-1)
  } finally {
    await cleanupUser(email)
    await deleteVenue(venue.id)
  }
})

test('an unknown venue address shows "Venue not found" with a sign-in hint for owners, axe clean', async ({ page }) => {
  await page.goto(`http://e2e-nope-${Date.now()}.localhost:5179/`)
  await expect(page.getByRole('heading', { name: 'Venue not found' })).toBeVisible()
  const hint = page.getByRole('link', { name: /sign in to set it up/i })
  await expect(hint).toBeVisible()
  await expect(hint).toHaveAttribute('href', '/admin')
  expect(await axeBothSchemes(page)).toEqual([])
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
