// Bookings search (T11.5b): a guest books; an admin finds the booking on /admin/bookings by its reference (it opens
// in the panel, whatever the status filter), then by part of the guest's email, then sorts by when it was booked.
import { expect, test } from '@playwright/test'
import { axeBothSchemes, createAdmin, E2E_PREFIX, logInAdmin, pickFirstFreeSlot, venueDate } from './support/helpers.ts'

test('an admin finds a booking by its reference, then by its email', async ({ page, browser }) => {
  // A guest books in their own context.
  const email = `e2e-search-${Date.now()}@example.com`
  const guest = await browser.newContext({ ...test.info().project.use })
  const guestPage = await guest.newPage()
  await pickFirstFreeSlot(guestPage, { date: venueDate(13), sport: 'badminton', court: 'Badminton 4' })
  await guestPage.getByLabel('Name').fill(`${E2E_PREFIX} Searcher`)
  await guestPage.getByLabel('Email').fill(email)
  await guestPage.getByLabel('Phone').fill('0917 000 2468')
  await guestPage.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(guestPage.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
  const reference = new URL(guestPage.url()).pathname.split('/').pop()!
  await guest.close()

  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/bookings')
  // The default view is the review queue, which this unpaid booking isn't in; the search looks through everything.
  const search = page.getByRole('searchbox', { name: 'Search' })
  await search.fill(reference.toLowerCase().replace('cb-', ''))
  await search.press('Enter')
  await expect(page).toHaveURL(/[?&]q=/)
  await expect(page.getByRole('status').filter({ hasText: 'Searching all bookings' })).toBeVisible()
  const rows = page.getByRole('list', { name: 'Bookings' }).getByRole('listitem')
  await expect(rows).toHaveCount(1)
  await expect(rows.first().getByRole('button', { pressed: true })).toContainText(reference) // opened in the panel
  expect(await axeBothSchemes(page), 'search results').toEqual([])

  // Part of the email finds it too.
  await search.fill(email.slice(0, 18))
  await search.press('Enter')
  await expect(rows.filter({ hasText: reference })).toHaveCount(1)

  // Sorted by when it was booked, newest first: it's the most recent search match.
  await page.getByLabel('Sort by').selectOption('booked-desc')
  await expect(page).toHaveURL(/sort=booked-desc/)
  await expect(rows.first()).toContainText(reference)

  // Clearing goes back to the filtered view.
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(page).not.toHaveURL(/[?&]q=/)
  await expect(page.getByText(/Searching all bookings/)).toHaveCount(0)
})
