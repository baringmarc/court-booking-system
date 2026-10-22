// T9.11h: an admin edits the venue info in /admin/settings, and the public API serves it to anyone.
// (T9.11i adds the player-side pages; this checks what they will read.) Everything is restored afterwards.
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { createAdmin, E2E_PREFIX, logInAdmin, serviceClient } from './support/helpers.ts'
import { localSupabase } from './support/local.ts'

type Snapshot = {
  socials: { platform: string; url: string }[]
  amenities: { id: string; builtin_key: string | null; custom_name: string | null; created_at: string }[]
}
let before: Snapshot

test.beforeEach(async () => {
  const service = serviceClient()
  const { data: socials, error: e1 } = await service.from('venue_social_links').select('platform, url')
  // Ids and dates too, so restoring keeps the amenities' order.
  const { data: amenities, error: e2 } = await service.from('venue_amenities').select('id, builtin_key, custom_name, created_at')
  if (e1 || e2) throw e1 ?? e2
  before = { socials: socials ?? [], amenities: amenities ?? [] }
})

// Venue info is venue-wide: put links and amenities back as they were, and remove tagged sections.
test.afterEach(async () => {
  const service = serviceClient()
  await service.from('venue_info_sections').delete().like('title', `${E2E_PREFIX}%`).throwOnError()
  await service.from('venue_social_links').delete().not('url', 'is', null).throwOnError()
  if (before.socials.length) await service.from('venue_social_links').insert(before.socials as never).throwOnError()
  await service.from('venue_amenities').delete().not('id', 'is', null).throwOnError()
  if (before.amenities.length) await service.from('venue_amenities').insert(before.amenities).throwOnError()
})

test('an admin sets an amenity, an info section and a social link, and anyone can read them', async ({ page }) => {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/settings')

  // An amenity that is off: switch it on (it saves right away).
  const amenities = page.getByRole('region', { name: 'Amenities' })
  const firstOff = amenities.getByRole('checkbox', { checked: false }).first()
  await expect(firstOff).toBeVisible()
  const amenityLabel = (await firstOff.locator('xpath=..').innerText()).trim()
  const amenity = amenities.getByRole('checkbox', { name: amenityLabel, exact: true })
  await amenity.check() // optimistic: it flips at once, then the save confirms it
  await expect(amenity).toBeChecked()

  // A new section, moved up one place.
  const sections = page.getByRole('region', { name: 'Info sections' })
  const title = `${E2E_PREFIX} Parking ${Date.now()}`
  const add = sections.getByRole('form', { name: 'New info section' })
  await add.getByLabel('Title').fill(title)
  await add.getByLabel('Text').fill('Free parking for players.\n\n**Gate closes at 11 PM.**')
  await add.getByRole('button', { name: 'Add section' }).click()
  await expect(sections.getByText(title)).toBeVisible()
  await sections.getByRole('button', { name: `Move ${title} up` }).click()

  // A social link: a wrong host is refused before saving, then a right one saves.
  const socials = page.getByRole('form', { name: 'Social links' })
  await socials.getByLabel('TikTok').fill('https://www.facebook.com/claudex')
  await socials.getByRole('button', { name: 'Save links' }).click()
  await expect(socials.getByRole('alert')).toContainText('TikTok: use an https:// link')
  await socials.getByLabel('TikTok').fill('https://www.tiktok.com/@claudexcourts')
  await socials.getByRole('button', { name: 'Save links' }).click()
  await expect(socials.getByText('Saved')).toBeVisible()

  // The public side: an anonymous client reads all three.
  const { url, publishableKey } = localSupabase()
  const anon = createClient(url, publishableKey, { auth: { persistSession: false } })
  const { data: links } = await anon.from('venue_social_links').select('platform, url').eq('platform', 'tiktok')
  expect(links).toEqual([{ platform: 'tiktok', url: 'https://www.tiktok.com/@claudexcourts' }])
  const { data: rows } = await anon.from('venue_info_sections').select('title, sort_order').order('sort_order')
  const titles = (rows ?? []).map((r) => r.title)
  expect(titles.indexOf(title)).toBe(titles.length - 2) // added last, then moved up one
  const { count } = await anon.from('venue_amenities').select('id', { count: 'exact', head: true })
  expect(count).toBe(before.amenities.length + 1)
})
