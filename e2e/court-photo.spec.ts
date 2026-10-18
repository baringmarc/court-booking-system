// An admin uploads, replaces and removes a court photo, and players see it on / and /book. This runs the
// real browser downscale, the venue-media storage policies and the courts.photo_path CHECK end to end.
import { expect, test } from '@playwright/test'
import { createAdmin, E2E_PREFIX, logInAdmin, serviceClient } from './support/helpers.ts'

// A valid 1×1 PNG. The browser decodes it and re-encodes it before upload.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

async function storedPhotos(courtId: string) {
  const { data, error } = await serviceClient().storage.from('venue-media').list(`courts/${courtId}`)
  if (error) throw error
  return (data ?? []).map((f) => f.name)
}

test('an admin uploads, replaces and removes a court photo that players see on the home page and /book', async ({ page }) => {
  const service = serviceClient()
  const name = `${E2E_PREFIX} Photo Court ${Date.now()}`
  // Inactive, so it never shows up on public pages or in other flows.
  const { data: court, error } = await service.from('courts')
    .insert({ name, sport: 'tennis', default_hourly_rate: 500, is_active: false }).select('id').single()
  if (error) throw error

  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, `/admin/courts/${court.id}`)
  await expect(page.getByText(/No photo yet/)).toBeVisible()

  // Bytes that aren't an image fail the browser decode, before anything is sent.
  await page.getByLabel('Upload a photo').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('<html>no</html>') })
  await expect(page.getByRole('alert')).toHaveText("That file isn't a readable image.")
  expect(await storedPhotos(court.id)).toEqual([])

  // Upload
  await page.getByLabel('Upload a photo').setInputFiles({ name: 'court.png', mimeType: 'image/png', buffer: PNG })
  const photo = page.getByRole('img', { name: `Photo of ${name}` })
  await expect(photo).toBeVisible()
  // The public URL really serves the image (the 1×1 PNG keeps its size through the re-encode).
  await expect(photo).toHaveJSProperty('naturalWidth', 1)
  const firstSrc = await photo.getAttribute('src')
  expect(firstSrc).toMatch(/\/storage\/v1\/object\/public\/venue-media\/courts\/.+\.(webp|jpg)$/)
  expect(await storedPhotos(court.id)).toHaveLength(1)

  // Players see it on the home page court cards (activated only for this check; specs run one at a time).
  await service.from('courts').update({ is_active: true }).eq('id', court.id).throwOnError()
  try {
    await page.goto('/')
    const publicPhoto = page.getByRole('img', { name: `Photo of ${name}` })
    await publicPhoto.scrollIntoViewIfNeeded() // lazy-loaded
    await expect(publicPhoto).toHaveJSProperty('naturalWidth', 1)

    // And in the court info panel on /book
    await page.goto('/book?sport=tennis')
    await page.getByText('About the tennis courts').click()
    await expect(page.getByRole('group').getByRole('img', { name: `Photo of ${name}` })).toBeVisible()
  } finally {
    await service.from('courts').update({ is_active: false }).eq('id', court.id).throwOnError()
  }
  await page.goto(`/admin/courts/${court.id}`)
  await expect(photo).toBeVisible()

  // Replace: a new file name, and the old file is deleted
  await page.getByLabel('Replace photo').setInputFiles({ name: 'court2.png', mimeType: 'image/png', buffer: PNG })
  await expect(photo).not.toHaveAttribute('src', firstSrc!)
  await expect.poll(() => storedPhotos(court.id)).toHaveLength(1)
  const secondName = (await photo.getAttribute('src'))!.split('/').pop()
  expect(await storedPhotos(court.id)).toEqual([secondName])

  // Remove
  await page.getByRole('button', { name: 'Remove photo' }).click()
  await expect(page.getByText(/No photo yet/)).toBeVisible()
  await expect.poll(() => storedPhotos(court.id)).toEqual([])
  const { data: row } = await service.from('courts').select('photo_path').eq('id', court.id).single()
  expect(row?.photo_path).toBeNull()
})
