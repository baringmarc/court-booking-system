import { readFileSync } from 'node:fs'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import jsqr from 'jsqr'
import { guardLeaks } from './support/leaks.ts'
import { createAdmin, logInAdmin } from './support/helpers.ts'

// T34.1: the booking-site QR code in the admin sidebar (desktop), the collapsed-sidebar dialog (desktop) and the mobile
// drawer (phone, 360px). Creates no data of its own besides the tagged admin account. The slug is the seeded venue's.
// jsqr is CommonJS: under Node's ESM loader the default import is the function, and its types say `.default`.
const jsQR = ((jsqr as unknown as { default?: typeof jsqr }).default ?? jsqr) as unknown as (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null
const NOTE = 'Share your booking site'
const serious = (violations: { impact?: string | null }[]) => violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')

async function signIn(page: Page) {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password)
  await page.goto('/admin')
}

async function drawn(img: Locator) {
  await expect(img).toBeVisible()
  await expect.poll(() => img.evaluate((el) => (el as unknown as { naturalWidth: number }).naturalWidth)).toBeGreaterThan(0)
}

/** Decodes a PNG in the browser (no PNG library in the repo) and reads the QR code in node with jsqr. */
async function decodePng(page: Page, bytes: Buffer): Promise<string | undefined> {
  const script = `(async () => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}), (c) => c.charCodeAt(0))], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0)
    const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data
    let binary = ''
    for (let i = 0; i < rgba.length; i += 0x8000) binary += String.fromCharCode.apply(null, rgba.subarray(i, i + 0x8000))
    return { width: bitmap.width, height: bitmap.height, data: btoa(binary) }
  })()`
  const image = (await page.evaluate(script)) as { width: number; height: number; data: string }
  expect(image.width).toBe(1024)
  expect(image.height).toBe(1024)
  const pixels = new Uint8ClampedArray(Buffer.from(image.data, 'base64'))
  return jsQR(pixels, image.width, image.height)?.data
}

test('T34.1 the sidebar card saves a PNG named after the venue that scans to the booking address', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the sidebar card is the desktop layout')
  await signIn(page)
  const sidebar = page.locator('aside.admin-sidebar')
  await drawn(sidebar.getByRole('img', { name: /^QR code for .+ booking site$/ }))
  await expect(sidebar.getByText(NOTE)).toBeVisible()
  const save = sidebar.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeEnabled()
  const pending = page.waitForEvent('download')
  await save.click()
  const file = await pending
  expect(file.suggestedFilename()).toBe('claudex-courts-booking-qr.png')
  const bytes = readFileSync((await file.path())!)
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  expect(await decodePng(page, bytes)).toBe(`${new URL(page.url()).origin}/book`)
})

test('T34.1 the sidebar card has no serious accessibility violations', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the sidebar card is the desktop layout')
  await signIn(page)
  await drawn(page.locator('aside.admin-sidebar').getByRole('img', { name: /^QR code for / }))
  const axe = await new AxeBuilder({ page }).include('aside.admin-sidebar').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(serious(axe.violations)).toEqual([])
})

test('T34.1 a collapsed sidebar shares through an icon that opens a dialog, accessibly', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the collapsed sidebar is the desktop layout')
  await signIn(page)
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  await expect(page.locator('aside.admin-sidebar').getByRole('img', { name: /^QR code for / })).toHaveCount(0)
  const icon = page.getByRole('button', { name: NOTE, exact: true })
  await icon.click()
  const dialog = page.getByRole('dialog', { name: NOTE })
  await expect(dialog).toBeVisible()
  await drawn(dialog.getByRole('img', { name: /^QR code for / }))
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  const axe = await new AxeBuilder({ page }).include('dialog[open]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(serious(axe.violations)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(icon).toBeFocused()
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
})

test('T34.1 on a 360px phone the drawer shows the QR code and note, accessibly', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'the drawer is the phone layout')
  await signIn(page)
  await page.getByRole('button', { name: 'Open navigation' }).click()
  const drawer = page.getByRole('dialog')
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText(NOTE)).toBeVisible()
  const img = drawer.getByRole('img', { name: /^QR code for / })
  await drawn(img)
  const save = drawer.getByRole('button', { name: 'Save', exact: true })
  await save.scrollIntoViewIfNeeded()
  await expect(save).toBeVisible()
  await expect(save).toBeEnabled()
  const axe = await new AxeBuilder({ page }).include('dialog.admin-drawer').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(serious(axe.violations)).toEqual([])
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
