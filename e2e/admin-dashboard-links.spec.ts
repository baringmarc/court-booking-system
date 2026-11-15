import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { createAdmin, logInAdmin } from './support/helpers.ts'

// T27.7: the Today's bookings card opens the bookings page already filtered to all statuses on the operating date.
// Labels: BookingFiltersBar.tsx ("Status" select #filter-status, "Date" input #filter-date). Creates no data.
test('T27.7 the Today\'s bookings card opens bookings filtered to today', async ({ page }) => {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password)
  await page.goto('/admin')
  const card = page.getByRole('heading', { name: "Today's bookings", exact: true }).locator('xpath=ancestor::section[1]')
  await card.getByRole('link', { name: 'Open bookings' }).click()
  await expect(page).toHaveURL(/\/admin\/bookings\?(?=.*status=all)(?=.*date=\d{4}-\d{2}-\d{2})/)
  const date = new URL(page.url()).searchParams.get('date')!
  // Within a day of the venue-local (Manila) date: the operating day can still be yesterday just after midnight.
  const manila = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
  expect(Math.abs(Date.parse(date) - Date.parse(manila))).toBeLessThanOrEqual(86_400_000)
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue(date)
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('all')
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
