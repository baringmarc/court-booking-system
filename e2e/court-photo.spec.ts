// T9.7: an admin builds a court's photo gallery (add several, make cover, remove) and players see the cover on /
// and every photo in the /book gallery. This runs the real browser downscale, the venue-media storage policies
// and the court_photos rules end to end.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { createAdmin, E2E_PREFIX, logInAdmin, serviceClient } from './support/helpers.ts'

// A valid 1×1 PNG. The browser decodes it and re-encodes it before upload.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const png = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG })

async function storedPhotos(courtId: string) {
  const { data, error } = await serviceClient().storage.from('venue-media').list(`courts/${courtId}`)
  if (error) throw error
  return (data ?? []).map((f) => f.name)
}

async function galleryRows(courtId: string) {
  const { data, error } = await serviceClient().from('court_photos').select('path').eq('court_id', courtId).order('sort_order')
  if (error) throw error
  return (data ?? []).map((r) => r.path.split('/').pop())
}

test('an admin builds a court gallery that players see on the home page and /book', async ({ page }) => {
  const service = serviceClient()
  const name = `${E2E_PREFIX} Photo Court ${Date.now()}`
  // Inactive, so it never shows up on public pages or in other flows.
  const { data: court, error } = await service.from('courts')
    .insert({ name, sport: 'tennis', default_hourly_rate: 500, is_active: false }).select('id').single()
  if (error) throw error

  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, `/admin/courts/${court.id}`)
  await expect(page.getByText(/No photos yet/)).toBeVisible()

  // Bytes that aren't an image fail the browser decode, before anything is sent.
  await page.getByLabel('Add photos').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('<html>no</html>') })
  await expect(page.getByRole('alert')).toHaveText("fake.png: That file isn't a readable image.")
  expect(await storedPhotos(court.id)).toEqual([])

  // Two at once: both are stored, in the order picked, and the first is the cover.
  await page.getByLabel('Add photos').setInputFiles([png('one.png'), png('two.png')])
  const first = page.getByRole('img', { name: `Photo 1 of ${name}` })
  const second = page.getByRole('img', { name: `Photo 2 of ${name}` })
  await expect(second).toBeVisible()
  await expect(first).toHaveJSProperty('naturalWidth', 1) // the public URL really serves the image
  await expect(page.getByRole('listitem').filter({ has: first }).getByText('Cover')).toBeVisible()
  await expect.poll(() => storedPhotos(court.id)).toHaveLength(2)
  const [one, two] = await galleryRows(court.id)

  // Make the second photo the cover.
  await page.getByRole('button', { name: 'Make cover: photo 2' }).click()
  await expect(first).toHaveAttribute('src', new RegExp(`${two}$`))
  await expect.poll(() => galleryRows(court.id)).toEqual([two, one])

  // Players: the cover on the home page, both photos in the /book gallery (activated only for this check).
  await service.from('courts').update({ is_active: true }).eq('id', court.id).throwOnError()
  try {
    await page.goto('/')
    const cover = page.getByRole('img', { name: `Photo of ${name}` })
    await cover.scrollIntoViewIfNeeded() // lazy-loaded
    await expect(cover).toHaveAttribute('src', new RegExp(`${two}$`))
    await expect(cover).toHaveJSProperty('naturalWidth', 1)

    await page.goto('/book?sport=tennis')
    await page.getByText('About the tennis courts').click()
    const gallery = page.getByRole('group', { name: `Photos of ${name}` })
    await expect(gallery.getByRole('img')).toHaveCount(2)
    await expect(gallery.getByText('1 of 2')).toBeVisible()
    await gallery.getByRole('button', { name: `Next photo of ${name}` }).click()
    await expect(gallery.getByText('2 of 2')).toBeVisible()
    // The a11y spec never sees a multi-photo gallery (seed courts have one photo at most): check it here.
    const axe = await new AxeBuilder({ page }).include('.gallery').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([])
  } finally {
    await service.from('courts').update({ is_active: false }).eq('id', court.id).throwOnError()
  }

  // Remove the cover: the row and the file go, and the other photo becomes the cover.
  await page.goto(`/admin/courts/${court.id}`)
  await page.getByRole('button', { name: 'Remove photo 1' }).click()
  await expect(page.getByRole('img', { name: `Photo 2 of ${name}` })).toHaveCount(0)
  await expect.poll(() => galleryRows(court.id)).toEqual([one])
  await expect.poll(() => storedPhotos(court.id)).toEqual([one])

  // Nothing writes the old single-photo column any more.
  const { data: row } = await service.from('courts').select('photo_path').eq('id', court.id).single()
  expect(row?.photo_path).toBeNull()
})
