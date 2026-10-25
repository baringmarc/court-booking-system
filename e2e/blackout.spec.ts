// T10.3: an admin adds a blackout with the date and hour pickers; a guest picks that date in /book's calendar and
// sees the court closed then. The pickers are checked with axe, light and dark, with the calendar open.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createAdmin, E2E_PREFIX, logInAdmin, pickDate, serviceClient, venueDate } from './support/helpers.ts'

const date = venueDate(23)

/** Serious or critical WCAG A/AA violations, in light and dark mode (the a11y spec's rule). */
async function axeViolations(page: Page) {
  const found: string[] = []
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    found.push(...results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${colorScheme} ${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`))
  }
  await page.emulateMedia({ colorScheme: null })
  return found
}

/** No sideways page scroll (a string, because the e2e tsconfig has no DOM types). */
async function overflow(page: Page) {
  return page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
}

// The blackout blocks real slots: remove it even when the test fails (global teardown is the backstop).
test.afterEach(async () => {
  const { error } = await serviceClient().from('blackouts').delete().like('reason', `${E2E_PREFIX}%`)
  if (error) throw error
})

test('an admin adds a blackout with the pickers, and a guest picking that date in the calendar sees it closed', async ({ page, browser }) => {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/schedule')
  const reason = `${E2E_PREFIX} Floor repair ${Date.now()}`

  await page.getByLabel('Court').selectOption({ label: 'Badminton 2' })
  await page.getByLabel('Reason').fill(reason)
  // The calendar dialog, open: axe and the 360px fit.
  await page.getByRole('group', { name: 'Starts on' }).getByRole('button', { name: /^Choose a date/ }).click()
  const calendar = page.getByRole('dialog', { name: 'Starts on' })
  await expect(calendar.getByRole('grid')).toBeVisible()
  expect(await axeViolations(page), 'the open calendar').toEqual([])
  expect(await overflow(page), 'the calendar scrolls sideways').toBeLessThanOrEqual(0)
  const box = await calendar.boundingBox()
  const grid = await calendar.getByRole('grid').boundingBox()
  expect(grid && box && grid.x + grid.width <= box.x + box.width, 'the month fits inside the dialog').toBe(true)
  await page.keyboard.press('Escape')
  await expect(calendar).toBeHidden()

  await pickDate(page, page, 'Starts on', date)
  await page.getByRole('group', { name: 'Starts at' }).getByRole('radio', { name: '2 PM', exact: true }).check()
  // The end day followed the start day.
  const startDay = await page.getByRole('group', { name: 'Starts on' }).getByRole('button', { name: /^Choose a date/ }).getAttribute('aria-label')
  await expect(page.getByRole('group', { name: 'Ends on' }).getByRole('button', { name: /^Choose a date/ })).toHaveAccessibleName(startDay ?? '')
  await page.getByRole('group', { name: 'Ends at' }).getByRole('radio', { name: '4 PM', exact: true }).check()
  expect(await axeViolations(page), 'the blackout form').toEqual([])
  await page.getByRole('button', { name: 'Add blackout' }).click()
  const listed = page.getByRole('listitem').filter({ hasText: reason })
  await expect(listed).toBeVisible()
  await expect(listed).toContainText('Badminton 2')
  await expect(listed).toContainText('2:00 PM')
  await expect(listed).toContainText('4:00 PM')

  // A guest goes to /book and picks the date in the calendar; the URL follows.
  const guestContext = await browser.newContext({ ...test.info().project.use })
  const guest = await guestContext.newPage()
  await guest.goto('/book?sport=badminton')
  await expect(guest.getByRole('group', { name: 'Date' }).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')
  await pickDate(guest, guest, 'Date', date)
  await expect(guest).toHaveURL(new RegExp(`date=${date}`))
  await expect(guest.getByRole('button', { name: 'Badminton 2, 2 PM – 3 PM, Closed' })).toBeDisabled()
  await expect(guest.getByRole('button', { name: 'Badminton 2, 3 PM – 4 PM, Closed' })).toBeDisabled()
  await expect(guest.getByRole('button', { name: /^Badminton 2, 4 PM – 5 PM, ₱/ })).toBeEnabled()
  expect(await overflow(guest), '/book scrolls sideways').toBeLessThanOrEqual(0)
  await guestContext.close()

  // Removing it frees the slots again.
  page.once('dialog', (d) => d.accept())
  await listed.getByRole('button', { name: 'Remove' }).click()
  await expect(listed).toHaveCount(0)
})
