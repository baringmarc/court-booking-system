// The marketing site's two forms against the local Edge Functions (T15.6): a lead lands in the console and alerts
// by email; a review stays hidden from the public until the console approves it. Local stack only. Teardown removes
// E2E-tagged leads; reviews have no teardown, so each test deletes its own. Needs LEAD_ALERT_TO set in
// supabase/functions/.env (and the stack restarted), with the local functions served.
import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { E2E_PREFIX, createPlatformAdmin, serviceClient } from './support/helpers.ts'
import { localSupabase } from './support/local.ts'

const CONSOLE = 'http://app.localhost:5179/'

async function signInConsole(page: Page, path = '') {
  const admin = await createPlatformAdmin()
  await page.goto(CONSOLE + path)
  await expect(page.getByRole('heading', { name: 'Platform console' })).toBeVisible()
  await page.getByLabel('Email').fill(admin.email)
  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText(`Signed in as ${admin.email}`)).toBeVisible()
}

async function post(fn: 'site-contact' | 'site-review', body: Record<string, unknown>) {
  const { url, publishableKey } = localSupabase()
  const res = await fetch(`${url}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: publishableKey, Authorization: `Bearer ${publishableKey}` },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as { ok: boolean } }
}

function leadBody(email: string, venueName: string, extra: Record<string, unknown> = {}) {
  return {
    firstName: 'Ana', lastName: 'Reyes', email, phone: '09171234567', venueName, location: 'Quezon City', courts: 3,
    consent: true, website: '', started: Date.now() - 10_000, turnstileToken: 'e2e', ...extra,
  }
}

test('a contact-form lead reaches the console and alerts by email; bots and bad input store nothing', async ({ page }) => {
  const tag = Date.now().toString(36)
  const email = `e2e-contact-${tag}@example.com`
  const venueName = `${E2E_PREFIX} Lead ${tag}`
  const botEmail = `e2e-contact-bot-${tag}@example.com`
  const badEmail = `e2e-contact-bad-${tag}`
  const service = serviceClient()
  try {
    const ok = await post('site-contact', leadBody(email, venueName))
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ ok: true })

    // A filled honeypot is answered like a success but stores nothing.
    const bot = await post('site-contact', leadBody(botEmail, `${E2E_PREFIX} Bot ${tag}`, { website: 'http://spam.example' }))
    expect(bot.status).toBe(200)
    // An invalid email is refused.
    const bad = await post('site-contact', leadBody(badEmail, `${E2E_PREFIX} Bad ${tag}`))
    expect(bad.status).toBe(400)

    const count = async (e: string) => (await service.from('leads').select('id', { count: 'exact', head: true }).eq('email', e).throwOnError()).count
    expect(await count(email)).toBe(1)
    expect(await count(botEmail)).toBe(0)
    expect(await count(badEmail)).toBe(0)

    // The platform console lists it.
    await signInConsole(page, `leads?q=${encodeURIComponent(venueName)}`)
    await expect(page).toHaveURL(/\/leads\?/)
    const lead = page.getByRole('main').getByRole('listitem').filter({ hasText: venueName })
    await expect(lead).toBeVisible()
    await lead.getByRole('button', { name: /details/i }).click()
    const panel = page.getByRole('dialog', { name: new RegExp(venueName) }).or(page.getByRole('region', { name: new RegExp(venueName) }))
    await expect(panel.getByRole('button', { name: 'Create venue' })).toBeVisible()

    // The alert goes to LEAD_ALERT_TO, not to the lead, so search by subject.
    const { mailpitUrl } = localSupabase()
    const subject = `New lead: ${venueName} (Quezon City)`
    await expect.poll(async () => {
      const res = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`subject:"New lead" ${venueName}`)}`)
      const found = (await res.json()) as { messages: { Subject: string }[] }
      return found.messages.map((m) => m.Subject)
    }, { message: 'lead alert email' }).toContain(subject)
  } finally {
    await service.from('leads').delete().in('email', [email, botEmail, badEmail])
    await service.from('leads').delete().like('venue_name', `%${tag}`)
  }
})

test('a site review stays hidden until the console approves it, and hides again', async ({ page }) => {
  const tag = Date.now().toString(36)
  const name = `${E2E_PREFIX} Reviewer ${tag}`
  const service = serviceClient()
  const { url, publishableKey } = localSupabase()
  const anon = createClient(url, publishableKey, { auth: { persistSession: false } })
  const visibleToAnon = async () => (await anon.from('reviews').select('name').eq('name', name)).data?.length ?? -1
  try {
    const sent = await post('site-review', {
      name, role: 'player', venue: `${E2E_PREFIX} Court ${tag}`, quote: 'Booking a court takes seconds now.', rating: 5,
      consent: true, website: '', started: Date.now() - 10_000,
    })
    expect(sent.status).toBe(200)
    expect(sent.body.ok).toBe(true)

    const { data: stored } = await service.from('reviews').select('approved, rating').eq('name', name).single().throwOnError()
    expect(stored).toEqual({ approved: false, rating: 5 })
    expect(await visibleToAnon()).toBe(0)

    await signInConsole(page, `reviews?q=${encodeURIComponent(name)}`)
    const row = page.getByRole('main').getByRole('listitem').filter({ hasText: name })
    await expect(row).toContainText('Hidden')
    await row.getByRole('button', { name: /details/i }).click()
    const item = page.getByRole('dialog', { name: new RegExp(name) }).or(page.getByRole('region', { name: new RegExp(name) }))
    await item.getByRole('button', { name: 'Approve' }).click()
    await expect(item).toContainText('Approved')
    await expect(item.getByRole('button', { name: 'Hide' })).toBeVisible()
    await expect.poll(visibleToAnon).toBe(1)

    await item.getByRole('button', { name: 'Hide' }).click()
    await expect(item.getByRole('button', { name: 'Approve' })).toBeVisible()
    await expect.poll(visibleToAnon).toBe(0)
  } finally {
    await service.from('reviews').delete().eq('name', name)
  }
})
