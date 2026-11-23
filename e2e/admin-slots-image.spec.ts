import { readFileSync } from 'node:fs'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Download, type Locator, type Page } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { createAdmin, logInAdmin } from './support/helpers.ts'

// T31.1b: the "Post open slots" button on the dashboard opens a dialog with a preview, download and caption.
// Seeded Claudex Courts has courts (Badminton 1 ... Tennis Court, supabase/seed.sql). Creates no data of its own besides
// the tagged admin account. Slots depend on the wall clock, so no range is asserted: only its shape or "Fully booked".
const FILE = /^[a-z0-9-]+-slots-\d{4}-\d{2}-\d{2}\.png$/
const RANGE = /^\d{1,2}(:\d\d)?( [AP]M)?–\d{1,2}(:\d\d)? [AP]M( \(next day\))?$/

async function openDialog(page: Page): Promise<Locator> {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password)
  await page.goto('/admin')
  await page.getByRole('button', { name: 'Post open slots', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Post your open courts' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function download(page: Page, dialog: Locator): Promise<Download> {
  const button = dialog.getByRole('button', { name: 'Download picture', exact: true })
  await expect(button).toBeEnabled()
  const pending = page.waitForEvent('download')
  await button.click()
  return pending
}

test('T31.1b the dialog draws a picture and Download picture saves a PNG named after the venue and the day', async ({ page }) => {
  const dialog = await openDialog(page)
  const img = dialog.getByRole('img', { name: /^Open slots today at / })
  await expect(img).toBeVisible()
  await expect.poll(() => img.evaluate((el) => (el as unknown as { naturalWidth: number }).naturalWidth)).toBeGreaterThan(0)
  const file = await download(page, dialog)
  expect(file.suggestedFilename()).toMatch(FILE)
  const bytes = readFileSync((await file.path())!)
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
})

test('T31.1b Tomorrow previews and downloads the next day', async ({ page }) => {
  const dialog = await openDialog(page)
  const today = (await download(page, dialog)).suggestedFilename().match(/(\d{4}-\d{2}-\d{2})\.png$/)![1]
  await dialog.getByRole('radio', { name: /^Tomorrow · / }).check()
  await expect(dialog.getByRole('radio', { name: /^Tomorrow · / })).toBeChecked()
  await expect(dialog.getByRole('img', { name: /^Open slots tomorrow at / })).toBeVisible()
  const tomorrow = (await download(page, dialog)).suggestedFilename().match(/(\d{4}-\d{2}-\d{2})\.png$/)![1]
  expect(Date.parse(tomorrow) - Date.parse(today)).toBe(86_400_000)
})

test('T31.1b Copy caption puts the open slots and the booking address on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Copy caption', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
  const text: string = await page.evaluate(() => (navigator as unknown as { clipboard: { readText(): Promise<string> } }).clipboard.readText())
  expect(text).toBe(await dialog.getByRole('textbox', { name: 'Caption' }).inputValue())
  expect(text).toMatch(/^Open slots today at .+:/)
  expect(text).toMatch(/Book at https?:\/\//)
  const lines = text.split('\n')
  const blank = lines.indexOf('')
  const courtLines = lines.slice(1, blank)
  expect(courtLines.length).toBeGreaterThan(0)
  expect(courtLines.some((l) => l.startsWith('Badminton 1: '))).toBe(true)
  for (const line of courtLines) {
    const [, rest] = line.split(/^[^:]+: /)
    expect(rest, line).toBeTruthy()
    if (rest !== 'Fully booked') for (const label of rest.split(', ')) expect(label, line).toMatch(RANGE)
  }
})

test('T31.1b Escape closes the dialog and focus returns to Post open slots', async ({ page }) => {
  const dialog = await openDialog(page)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Post open slots', exact: true })).toBeFocused()
})

test('T31.1b the dialog has no serious accessibility violations on a 360px phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  const dialog = await openDialog(page)
  await expect(dialog.getByRole('img', { name: /^Open slots today at / })).toBeVisible()
  for (const name of ['Download picture', 'Copy caption']) {
    const b = dialog.getByRole('button', { name, exact: true })
    await b.scrollIntoViewIfNeeded()
    await expect(b).toBeVisible()
  }
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
