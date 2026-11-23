import { readFileSync } from 'node:fs'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Download, type Page } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { createAdmin, logInAdmin } from './support/helpers.ts'

// T31.1: the Slots image control in the dashboard's Today's courts card (download, copy caption, tomorrow).
// Seeded Claudex Courts has courts (Badminton 1 ... Tennis Court, supabase/seed.sql). Creates no data of its own besides
// the tagged admin account. Slots depend on the wall clock, so no range is asserted: only its shape or "Fully booked".
const FILE = /^[a-z0-9-]+-slots-\d{4}-\d{2}-\d{2}\.png$/
const RANGE = /^\d{1,2}(:\d\d)?( [AP]M)?–\d{1,2}(:\d\d)? [AP]M( \(next day\))?$/

async function openDashboard(page: Page) {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password)
  await page.goto('/admin')
  const control = page.getByRole('group', { name: 'Slots image' })
  await expect(control).toBeVisible()
  return control
}

async function download(page: Page): Promise<Download> {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download image', exact: true }).click()
  return pending
}

test('T31.1 Download image saves a PNG named after the venue and the day', async ({ page }) => {
  await openDashboard(page)
  await expect(page.getByRole('radio', { name: 'Today', exact: true })).toBeChecked()
  const file = await download(page)
  expect(file.suggestedFilename()).toMatch(FILE)
  const bytes = readFileSync((await file.path())!)
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
})

test('T31.1 Copy caption puts the open slots and the booking address on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openDashboard(page)
  await page.getByRole('button', { name: 'Copy caption', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
  const text: string = await page.evaluate(() => (navigator as unknown as { clipboard: { readText(): Promise<string> } }).clipboard.readText())
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

test('T31.1 Tomorrow downloads the next day', async ({ page }) => {
  await openDashboard(page)
  const today = (await download(page)).suggestedFilename().match(/(\d{4}-\d{2}-\d{2})\.png$/)![1]
  await page.getByRole('radio', { name: 'Tomorrow', exact: true }).check()
  await expect(page.getByRole('radio', { name: 'Tomorrow', exact: true })).toBeChecked()
  const tomorrow = (await download(page)).suggestedFilename().match(/(\d{4}-\d{2}-\d{2})\.png$/)![1]
  expect(Date.parse(tomorrow) - Date.parse(today)).toBe(86_400_000)
})

test('T31.1 the control has no serious accessibility violations on a 360px phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  const control = await openDashboard(page)
  await control.scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Download image', exact: true })).toBeVisible()
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
