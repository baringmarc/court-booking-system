// T9.11h/i: an admin edits the venue info in /admin/settings; the public API serves it to anyone, and players see it
// on the home page (and checkout links the cancellation policy). Everything is restored afterwards.
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { axeBothSchemes, createAdmin, E2E_PREFIX, logInAdmin, serviceClient } from './support/helpers.ts'
import { localSupabase } from './support/local.ts'

type Snapshot = {
  socials: { platform: string; url: string }[]
  amenities: { id: string; builtin_key: string | null; custom_name: string | null; created_at: string }[]
  location: { address: string; maps_url: string }
}
let before: Snapshot

test.beforeEach(async () => {
  const service = serviceClient()
  const { data: socials, error: e1 } = await service.from('venue_social_links').select('platform, url')
  // Ids and dates too, so restoring keeps the amenities' order.
  const { data: amenities, error: e2 } = await service.from('venue_amenities').select('id, builtin_key, custom_name, created_at')
  const { data: location, error: e3 } = await service.from('venue_settings').select('address, maps_url').single()
  if (e1 || e2 || e3) throw e1 ?? e2 ?? e3
  before = { socials: socials ?? [], amenities: amenities ?? [], location: location! }
})

// Venue info is venue-wide: put links and amenities back as they were, and remove tagged sections.
test.afterEach(async () => {
  const service = serviceClient()
  await service.from('venue_info_sections').delete().like('title', `${E2E_PREFIX}%`).throwOnError()
  await service.from('venue_social_links').delete().not('url', 'is', null).throwOnError()
  if (before.socials.length) await service.from('venue_social_links').insert(before.socials as never).throwOnError()
  await service.from('venue_amenities').delete().not('id', 'is', null).throwOnError()
  if (before.amenities.length) await service.from('venue_amenities').insert(before.amenities).throwOnError()
  await service.from('venue_settings').update(before.location).eq('id', true).throwOnError()
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
  // Reorder with the handle's tap menu (T11.5a; a way without dragging).
  await sections.getByRole('button', { name: `Reorder ${title}` }).click()
  await sections.getByRole('group', { name: `Move ${title}` }).getByRole('button', { name: 'Move up' }).click()
  // Then drag it by its handle to the top of the list.
  const list = sections.getByRole('list', { name: 'Info sections in order' })
  const handle = list.getByRole('button', { name: `Reorder ${title}` })
  const first = list.getByRole('listitem').first()
  const from = (await handle.boundingBox())!
  const top = (await first.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, top.y + 4, { steps: 15 })
  await page.mouse.up()
  await expect(list.getByRole('listitem').first()).toContainText(title)
  // The section list's handles and an open move menu are accessible in both colour schemes (T11.5a).
  await sections.getByRole('button', { name: `Reorder ${title}` }).click()
  await expect(sections.getByRole('group', { name: `Move ${title}` })).toBeVisible()
  expect(await axeBothSchemes(page, '[aria-label="Info sections in order"]'), 'info sections with a menu open').toEqual([])
  await page.keyboard.press('Escape')
  expect(await axeBothSchemes(page, '[aria-label="Info sections in order"]'), 'info sections').toEqual([])

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
  expect(titles.indexOf(title)).toBe(0) // added last, moved up one, then dragged to the top
  const { count } = await anon.from('venue_amenities').select('id', { count: 'exact', head: true })
  expect(count).toBe(before.amenities.length + 1)

  // T9.11i: the location, then the home page as a player (same device size, signed out).
  const location = page.getByRole('form', { name: 'Location' })
  await location.getByLabel('Address', { exact: true }).fill('123 Rizal Ave, Makati City')
  // A link that isn't Google Maps is refused before saving.
  await location.getByLabel(/Google Maps link/).fill('https://maps.google.com.evil.test/x')
  await location.getByRole('button', { name: 'Save location' }).click()
  await expect(location.getByRole('alert')).toContainText('Paste a Google Maps link')
  await location.getByLabel(/Google Maps link/).fill('https://maps.app.goo.gl/E2eAyalaTriangle')
  await location.getByRole('button', { name: 'Save location' }).click()
  await expect(location.getByText('Saved')).toBeVisible()

  const player = await page.context().browser()!.newContext({ ...test.info().project.use })
  const home = await player.newPage()
  await home.goto('/')
  await expect(home.getByRole('list').filter({ has: home.getByText(amenityLabel, { exact: true }) })).toBeVisible()
  // T11.24: the address and its Maps link are in the hero, under the heading; there is no Location card on /.
  const hero = home.locator('.hero')
  await expect(hero.getByText('123 Rizal Ave, Makati City')).toBeVisible()
  await expect(home.getByRole('region', { name: 'Location' })).toHaveCount(0)
  // T11.9: no embedded map; the address itself links to the pasted URL, in a new tab.
  await expect(home.locator('iframe')).toHaveCount(0)
  const mapLink = hero.getByRole('link', { name: /123 Rizal Ave, Makati City/ })
  await expect(mapLink).toHaveAttribute('href', 'https://maps.app.goo.gl/E2eAyalaTriangle')
  await expect(mapLink).toHaveAttribute('target', '_blank')
  // Quick facts: the active courts and the slot length.
  const facts = hero.getByRole('list', { name: 'Quick facts' })
  await expect(facts.getByText(/^\d+ courts?$/)).toBeVisible()
  await expect(facts.getByText(/^\d+-min slots$/)).toBeVisible()
  // No sideways scroll (the phone project runs at 360px).
  expect(await home.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBeLessThanOrEqual(0)
  // Social links are in the footer's "Stay connected" band now, not the hero (T11.4).
  await expect(hero.getByRole('link', { name: /^TikTok/ })).toHaveCount(0)
  const band = home.getByRole('region', { name: 'Connect with us' })
  await expect(band.getByRole('link', { name: /^TikTok/ })).toHaveAttribute('href', 'https://www.tiktok.com/@claudexcourts')
  await expect(band.getByRole('link', { name: /^TikTok/ }).locator('svg[data-platform="tiktok"]')).toBeVisible()
  const panel = home.locator('details').filter({ hasText: title })
  await panel.getByText(title).click()
  await expect(panel.getByText('Gate closes at 11 PM.')).toBeVisible()
  expect(await axeBothSchemes(home)).toEqual([])
  await player.close()
})
