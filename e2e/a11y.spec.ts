// Accessibility pass (T8.5): axe finds no serious or critical WCAG 2.1 A/AA violations on the main
// pages, in light and dark mode, and no page scrolls sideways at 360px or at 200% zoom.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createAdmin, createPlayer, E2E_PREFIX, logInAdmin, pickFirstFreeSlot, venueDate } from './support/helpers.ts'

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

/** Runs axe in both colour schemes and checks the page reflows (no sideways page scroll). */
async function checkPage(page: Page, name: string) {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    expect(await axeViolations(page), `${name} (${colorScheme})`).toEqual([])
  }
  await page.emulateMedia({ colorScheme: null })
  // A string, because the e2e tsconfig has no DOM types.
  const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0)
}

/** Opens /book on a quiet day and waits for the slot grid. */
async function openBook(page: Page) {
  await page.goto(`/book?date=${venueDate(14)}&sport=badminton`)
  await expect(page.getByRole('button', { name: /^Badminton 1, .*₱/ }).first()).toBeVisible()
}

test('public and player pages have no serious accessibility violations', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await checkPage(page, 'home')

  const player = await createPlayer('a11y')
  await page.goto('/login')
  await checkPage(page, 'login')
  await page.getByLabel('Email').fill(player.email)
  await page.getByLabel('Password').fill(player.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()

  await openBook(page)
  await checkPage(page, 'book')
  const slot = page.getByRole('button', { name: /^Badminton 1, .*₱/ }).first()
  await slot.click()
  await expect(slot).toHaveAttribute('aria-pressed', 'true')
  await checkPage(page, 'book with a selection')

  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible()
  await page.getByLabel('Name').fill(`${E2E_PREFIX} A11y`)
  await checkPage(page, 'checkout')
  await page.getByRole('button', { name: 'Confirm booking' }).click()

  await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
  await checkPage(page, 'booking')

  await page.goto('/me/bookings')
  await expect(page.getByRole('link', { name: /CB-[A-Z0-9]{6}/ }).first()).toBeVisible()
  await checkPage(page, 'my bookings')
})

test('the guest booking page (with its private link) has no serious accessibility violations', async ({ page }) => {
  await pickFirstFreeSlot(page, { date: venueDate(14), sport: 'badminton', court: 'Badminton 2' })
  await page.getByLabel('Name').fill(`${E2E_PREFIX} A11y Guest`)
  await page.getByLabel('Email').fill(`e2e-a11y-${Date.now()}@example.com`)
  await page.getByLabel('Phone').fill('0917 000 4321')
  await checkPage(page, 'guest checkout')
  await page.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(page.getByRole('heading', { name: 'Save this link' })).toBeVisible()
  await checkPage(page, 'guest booking')

  // The cancel confirmation shows the danger button (T9.2: its text failed contrast in dark mode).
  await page.getByRole('button', { name: 'Cancel booking' }).click()
  await expect(page.getByRole('button', { name: 'Yes, cancel booking' })).toBeVisible()
  await checkPage(page, 'cancel confirmation')
})

test('admin pages have no serious accessibility violations', async ({ page }) => {
  const admin = await createAdmin()
  await page.goto('/admin/login')
  await expect(page.getByRole('heading', { name: 'Admin log in' })).toBeVisible()
  await checkPage(page, 'admin login')

  await logInAdmin(page, admin.email, admin.password)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /Loading/ })).toHaveCount(0)
  await checkPage(page, 'admin dashboard')

  await page.goto(`/admin/bookings?status=all&date=${venueDate(1)}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /Loading/ })).toHaveCount(0)
  await checkPage(page, 'admin bookings')
})

test('pages reflow at 200% zoom', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The phone project already runs every check at 360px.')
  // 200% zoom on a 1280px window lays the page out in 640 CSS pixels.
  await page.setViewportSize({ width: 640, height: 360 })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await checkPage(page, 'home at 200%')
  await openBook(page)
  await checkPage(page, 'book at 200%')
})
