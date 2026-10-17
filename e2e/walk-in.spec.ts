// An admin records a walk-in from the dashboard; the slot then shows as booked to everyone.
import { expect, test } from '@playwright/test'
import { createAdmin, E2E_PREFIX, logIn, venueDate } from './support/helpers.ts'

test('an admin records a walk-in and the slot shows as booked on /book', async ({ page }) => {
  const admin = await createAdmin()
  await logIn(page, admin.email, admin.password)
  await page.goto('/admin')
  await page.getByRole('button', { name: '+ Walk-in' }).click()

  const form = page.getByRole('form', { name: 'Walk-in booking' })
  const closed = page.getByText('The venue is closed today.')
  await expect(form.or(closed)).toBeVisible() // wait for today's availability to load
  test.skip(await closed.isVisible(), 'The venue is closed today, so no walk-in can be recorded.')

  await form.getByLabel('Court').selectOption({ label: 'Badminton 4' })
  const start = form.getByLabel('Start')
  const options = start.locator('option:not([value=""])')
  test.skip((await options.count()) === 0, 'No free start times left today on Badminton 4.')
  const hourLabel = ((await options.last().textContent()) ?? '').replace(' (now)', '').trim()
  await start.selectOption({ index: await options.count() })
  await form.getByLabel('Customer name').fill(`${E2E_PREFIX} Walk-in`)
  await form.getByRole('button', { name: 'Record walk-in' }).click()
  await expect(page.getByRole('status').filter({ hasText: /Walk-in CB-[A-Z0-9]{6} recorded and confirmed/ })).toBeVisible()

  await page.goto(`/book?date=${venueDate(0)}&sport=badminton`)
  await expect(page.getByRole('button', { name: `Badminton 4, ${hourLabel}, Booked` })).toBeDisabled()
})
