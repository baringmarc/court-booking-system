// An admin sets, replaces and removes the venue logo in Settings > Appearance. Runs the real browser crop,
// the venue-media storage policies and the venue_settings logo_path column end to end.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { createAdmin, logInAdmin, serviceClient, venueId } from './support/helpers.ts'

// A valid 1×1 PNG. The browser decodes it and re-encodes it before upload.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

async function storedLogos() {
  const { data, error } = await serviceClient().storage.from('venue-media').list(`${await venueId()}/logo`)
  if (error) throw error
  return (data ?? []).map((f) => f.name)
}

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

test('an admin sets, replaces and removes the venue logo', async ({ page }) => {
  const { data: before } = await serviceClient().from('venue_settings').select('logo_path').single()
  // The logo is venue-wide; never overwrite one someone set on their local stack.
  test.skip(!!before?.logo_path, 'A logo is already set locally.')

  const { data: settings } = await serviceClient().from('venue_settings').select('name').single()
  try {
    await runFlow(page, `${settings!.name} logo`)
  } finally {
    // Close the page first so no save from a failed run can land after the cleanup.
    await page.close()
    await clearLogo()
  }
})

async function clearLogo() {
  const service = serviceClient()
  const id = await venueId()
  await service.from('venue_settings').update({ logo_path: null }).eq('venue_id', id)
  const files = await storedLogos()
  if (files.length) await service.storage.from('venue-media').remove(files.map((f) => `${id}/logo/${f}`))
}

async function runFlow(page: Page, alt: string) {
  const id = await venueId()
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/settings/appearance')
  const form = page.getByRole('form', { name: 'Logo' })
  await expect(page.getByRole('heading', { name: 'Venue logo' })).toBeVisible()

  // An image is required
  await form.getByRole('button', { name: 'Save logo' }).click()
  await expect(form.getByLabel('Logo image')).toHaveAccessibleDescription(/Choose an image for the logo/)
  expect(await storedLogos()).toEqual([])

  // Set
  await form.getByLabel('Logo image').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG })
  await form.getByRole('button', { name: 'Save logo' }).click()
  const preview = page.getByRole('img', { name: alt })
  await expect(preview).toBeVisible()
  // Visible is not loaded: wait for the image to decode before reading its size (it flaked 1 in 3 on desktop, T31.3).
  await expect.poll(() => preview.evaluate((el) => (el as unknown as { complete: boolean }).complete)).toBe(true)
  expect(await preview.evaluate((el) => (el as unknown as { naturalWidth: number }).naturalWidth)).toBeGreaterThanOrEqual(1)
  await expect.poll(async () => (await storedLogos()).length).toBe(1)
  const { data: set } = await serviceClient().from('venue_settings').select('logo_path').single()
  expect(set!.logo_path).toMatch(new RegExp(`^${id}/logo/`))

  // Accessible, and no sideways scroll at the project's viewport (360px on the phone project)
  expect(await axeViolations(page), 'with a logo').toEqual([])
  const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  expect(overflow, 'scrolls sideways').toBeLessThanOrEqual(0)

  // Replace leaves exactly one stored file
  await page.reload()
  await page.getByRole('form', { name: 'Logo' }).getByLabel('Replace image').setInputFiles({ name: 'logo2.png', mimeType: 'image/png', buffer: PNG })
  await page.getByRole('form', { name: 'Logo' }).getByRole('button', { name: 'Save logo' }).click()
  // Exact match: "You have unsaved changes." is also a status and contains "saved".
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
  await expect
    .poll(async () => (await serviceClient().from('venue_settings').select('logo_path').single()).data?.logo_path)
    .not.toBe(set!.logo_path)
  await expect.poll(async () => (await storedLogos()).length).toBe(1)
  const { data: replaced } = await serviceClient().from('venue_settings').select('logo_path').single()
  expect(replaced!.logo_path).toMatch(new RegExp(`^${id}/logo/`))
  expect(replaced!.logo_path).not.toBe(set!.logo_path)

  // Remove, with a confirmation
  await page.reload()
  await page.getByRole('button', { name: 'Remove logo' }).click()
  const dialog = page.getByRole('dialog', { name: 'Remove the logo?' })
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('button', { name: 'Keep logo' })).toBeFocused()
  expect(await axeViolations(page), 'with the dialog open').toEqual([])
  await dialog.getByRole('button', { name: 'Remove it' }).click()
  await expect(page.getByRole('img', { name: alt })).toHaveCount(0)
  await expect(page.getByLabel('Logo image')).toBeVisible()
  await expect.poll(() => storedLogos()).toEqual([])
  const { data: after } = await serviceClient().from('venue_settings').select('logo_path').single()
  expect(after!.logo_path).toBeNull()
}

// H14: keep last, after this file's own cleanup.
guardLeaks()
