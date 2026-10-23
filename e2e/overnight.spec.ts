// T9.10: an admin opens a day past midnight; players see and book its after-midnight slots under that day.
import { expect, test } from '@playwright/test'
import { createAdmin, E2E_PREFIX, logInAdmin, serviceClient, venueDate } from './support/helpers.ts'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const date = venueDate(18)
const dow = (() => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
})()

let original: { day_of_week: number; open_time: string; close_time: string; is_closed: boolean }[] = []

test.beforeEach(async () => {
  const { data, error } = await serviceClient().from('operating_hours').select('day_of_week, open_time, close_time, is_closed')
  if (error) throw error
  original = data
})

// Opening hours are venue-wide: put them back for the other specs, even when this one fails.
test.afterEach(async () => {
  for (const row of original) {
    const { error } = await serviceClient().from('operating_hours')
      .update({ open_time: row.open_time, close_time: row.close_time, is_closed: row.is_closed })
      .eq('day_of_week', row.day_of_week)
    if (error) throw error
  }
})

test('an admin opens a day until 2 AM and a guest books an after-midnight slot', async ({ page, browser }) => {
  const day = original.find((r) => r.day_of_week === dow)!
  test.skip(day.is_closed || day.close_time !== '22:00:00', 'Expects the seeded 06:00–22:00 hours on that day.')

  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/schedule')
  await page.getByLabel(`${DAY_NAMES[dow]} closes`).selectOption('2')
  await expect(page.getByText('closes next day')).toBeVisible()
  await page.getByRole('button', { name: 'Save hours' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()

  // A guest in their own browser session.
  // Same device as the project (360px on the phone run).
  const guestContext = await browser.newContext({ ...test.info().project.use })
  const guest = await guestContext.newPage()
  await guest.goto(`/book?date=${date}&sport=tennis`)
  await expect(guest.getByRole('rowheader', { name: '1 AM – 2 AM (next day)' })).toBeVisible()
  // The first free after-midnight slot (12 AM or 1 AM: the desktop and phone runs each take one).
  const slot = guest.getByRole('button', { name: /^Tennis Court, \d+ AM – \d+ AM \(next day\), ₱/ }).first()
  const hourLabel = (await slot.getAttribute('aria-label'))!.split(', ')[1]
  await slot.click()
  await expect(slot).toHaveAttribute('aria-pressed', 'true')
  await guest.getByRole('button', { name: 'Continue' }).click()
  await expect(guest.getByRole('heading', { name: 'Checkout' })).toBeVisible()
  // Checkout shows the slot's real calendar date: the day after the date it was picked under.
  const [y, m, d] = date.split('-').map(Number)
  const nextDayLabel = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d + 1, 4))) // noon in Manila
  await expect(guest.getByRole('definition').filter({ hasText: nextDayLabel })).toBeVisible()
  await guest.getByLabel('Name').fill(`${E2E_PREFIX} Night Owl`)
  await guest.getByLabel('Email').fill(`e2e-night-${Date.now()}@example.com`)
  await guest.getByLabel('Phone').fill('0917 000 2468')
  await guest.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(guest.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()

  // Booked under that day: the 1 AM slot now shows as booked when browsing that date.
  await guest.goto('about:blank')
  await guest.goto(`/book?date=${date}&sport=tennis`)
  await expect(guest.getByRole('button', { name: `Tennis Court, ${hourLabel}, Booked by ${E2E_PREFIX}` })).toBeDisabled()
  await guestContext.close()
})
