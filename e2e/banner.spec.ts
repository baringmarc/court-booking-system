// An admin sets and removes the home page banner, which players see on / and nowhere else. Runs the real
// browser downscale, the venue-media storage policies and the venue_settings banner CHECKs end to end.
import { expect, test, type Page } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { createAdmin, logInAdmin, serviceClient, venueId } from './support/helpers.ts'

// A valid 1×1 PNG. The browser decodes it and re-encodes it before upload.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

async function storedBanners() {
  const { data, error } = await serviceClient().storage.from('venue-media').list(`${await venueId()}/banner`)
  if (error) throw error
  return (data ?? []).map((f) => f.name)
}

test('an admin sets the banner, players see it on / only, and removing it hides it', async ({ page }) => {
  const { data: before } = await serviceClient().from('venue_settings').select('banner_path').single()
  // The banner is venue-wide; never overwrite one someone set on their local stack.
  test.skip(!!before?.banner_path, 'A banner is already set locally.')

  const { data: settings } = await serviceClient().from('venue_settings').select('name').single()
  const alt = `${settings!.name} banner`

  // Whatever happens below, leave no banner (or stored file) behind: the run set it, since none existed before.
  try {
    await runFlow(page, alt)
  } finally {
    await clearBanner()
  }
})

async function clearBanner() {
  const service = serviceClient()
  const { data } = await service.from('venue_settings').select('banner_path').single()
  await service.from('venue_settings').update({ banner_path: null, banner_alt: null }).eq('venue_id', await venueId())
  const folder = `${await venueId()}/banner`
  const files = await storedBanners()
  if (data?.banner_path || files.length) await service.storage.from('venue-media').remove(files.map((f) => `${folder}/${f}`))
}

async function runFlow(page: Page, alt: string) {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/settings/appearance')
  const form = page.getByRole('form', { name: 'Banner' })

  // There is no alt text field; an image is required
  await expect(form.getByLabel('Alt text')).toHaveCount(0)
  await form.getByRole('button', { name: 'Save banner' }).click()
  await expect(form.getByLabel('Banner image')).toHaveAccessibleDescription(/Choose an image for the banner/)
  expect(await storedBanners()).toEqual([])

  // Set: the alt text is "<venue name> banner"
  await form.getByLabel('Banner image').setInputFiles({ name: 'banner.png', mimeType: 'image/png', buffer: PNG })
  await form.getByRole('button', { name: 'Save banner' }).click()
  const preview = page.getByRole('img', { name: alt })
  await expect(preview).toBeVisible()
  await expect(preview).toHaveJSProperty('naturalWidth', 1)
  expect(await storedBanners()).toHaveLength(1)

  // Players see it on the home page, just below the header and before the page content…
  await page.goto('/')
  const banner = page.getByRole('img', { name: alt })
  await expect(banner).toBeVisible()
  await expect(banner).toHaveJSProperty('naturalWidth', 1)
  const heading = page.getByRole('heading', { level: 1 })
  expect((await banner.boundingBox())!.y).toBeLessThan((await heading.boundingBox())!.y)
  // …and nowhere else.
  await page.goto('/book')
  await expect(page.getByRole('heading', { name: 'Book a court' })).toBeVisible()
  await expect(page.getByRole('img', { name: alt })).toHaveCount(0)

  // Remove
  await page.goto('/admin/settings/appearance')
  await page.getByRole('button', { name: 'Remove banner' }).click()
  await expect(preview).toBeHidden()
  await expect(page.getByLabel('Banner image')).toBeVisible()
  await expect.poll(() => storedBanners()).toEqual([])
  const { data: after } = await serviceClient().from('venue_settings').select('banner_path, banner_alt').single()
  expect(after).toEqual({ banner_path: null, banner_alt: null })

  // The home page shows no banner (and leaves no empty space for one).
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.locator('.home-banner')).toHaveCount(0)
}

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
