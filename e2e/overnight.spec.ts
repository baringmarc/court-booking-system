// T9.10 / T17.15: an admin opens a day past midnight in the Weekly Hours editor; players see and book its after-midnight
// slots under that day. Runs in its own E2E venue with scheduling activated, so shared data is never touched.
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { addVenueStaff, createPlayer, createVenue, deleteVenue, E2E_PREFIX, serviceClient, submitAdminLogin, venueDate } from './support/helpers.ts'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const date = venueDate(18)
const dow = (() => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
})()

let venue: Awaited<ReturnType<typeof createVenue>> | undefined

test.beforeEach(async () => {
  venue = await createVenue('overnight')
})

test.afterEach(async () => {
  if (!venue) return
  // Bookings reference courts: remove them (payments cascade) before the venue goes.
  const { error } = await serviceClient().from('bookings').delete().eq('venue_id', venue.id)
  if (error) throw error
  await deleteVenue(venue.id)
  venue = undefined
})

test('an admin opens a day until 2 AM and a guest books an after-midnight slot', async ({ page, browser }) => {
  const staff = await createPlayer('overnight')
  await addVenueStaff(venue!.id, staff.id)
  await page.goto(`${venue!.url}/admin/schedule`)
  await submitAdminLogin(page, staff.email, staff.password)
  await expect(page.getByRole('switch', { name: 'Monday open' })).toBeVisible()
  const dayGroup = page.getByRole('group', { name: DAY_NAMES[dow] })
  await dayGroup.getByLabel(`${DAY_NAMES[dow]} closes`).selectOption({ label: '2 AM (next day)' })
  await page.getByRole('button', { name: 'Review & save' }).click()
  await page.getByRole('dialog', { name: 'Review changes' }).getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('region', { name: 'Unsaved changes' })).toHaveCount(0)

  // Bookings read the legacy hours until scheduling is activated: activate it for this venue only.
  const { error: activateError } = await serviceClient().from('venue_schedule_state').update({ schedule_v2_active: true }).eq('venue_id', venue!.id)
  if (activateError) throw activateError

  // A guest in their own browser session.
  // Same device as the project (360px on the phone run).
  const guestContext = await browser.newContext({ ...test.info().project.use })
  const guest = await guestContext.newPage()
  await guest.goto(`${venue!.url}/book?date=${date}&sport=tennis`)
  await expect(guest.getByRole('rowheader', { name: '1 AM – 2 AM (next day)' })).toBeVisible()
  // The first free after-midnight slot (12 AM or 1 AM: the desktop and phone runs each take one).
  const slot = guest.getByRole('button', { name: new RegExp(`^${venue!.court}, \\d+ AM – \\d+ AM \\(next day\\), ₱`) }).first()
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
  await guest.getByLabel('Mobile number (optional)').fill('0917 000 2468')
  await guest.getByLabel('I have read and accept the waiver').check()
  await guest.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(guest.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()

  // Booked under that day: the 1 AM slot now shows as booked when browsing that date.
  await guest.goto('about:blank')
  await guest.goto(`${venue!.url}/book?date=${date}&sport=tennis`)
  await expect(guest.getByRole('button', { name: `${venue!.court}, ${hourLabel}, Booked by ${E2E_PREFIX}` })).toBeDisabled()
  await guestContext.close()
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
