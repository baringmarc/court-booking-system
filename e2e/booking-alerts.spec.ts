// T11.21: a new-booking alert in the admin tab. With the admin on the dashboard, a guest in another browser
// context books and uploads a payment proof. Without a reload, the Bookings nav link reads "Bookings, 1 new";
// opening /admin/bookings shows the booking and clears the count.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { createAdmin, E2E_PREFIX, logInAdmin, pickFirstFreeSlot, uploadProof, venueDate } from './support/helpers.ts'

test('the admin sees a new booking arrive without reloading', async ({ page, browser }) => {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin')
  const nav = page.getByRole('navigation', { name: 'Admin' })
  await expect(nav.getByRole('link', { name: 'Bookings', exact: true })).toBeVisible()

  // A guest, in their own browser context, books and uploads a proof.
  const guestContext = await browser.newContext()
  const guest = await guestContext.newPage()
  await pickFirstFreeSlot(guest, { date: venueDate(12), sport: 'pickleball', court: 'Pickleball 1' })
  const guestName = `${E2E_PREFIX} Alert Guest`
  await guest.getByLabel('Name').fill(guestName)
  await guest.getByLabel('Email').fill(`e2e-alert-${Date.now()}@example.com`)
  await guest.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(guest.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
  const reference = new URL(guest.url()).pathname.split('/').pop()!
  await uploadProof(guest)

  // No reload on the admin page: the nav link gains the count.
  await expect(nav.getByRole('link', { name: 'Bookings, 1 new' })).toBeVisible()
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])

  await nav.getByRole('link', { name: 'Bookings, 1 new' }).click()
  await expect(page).toHaveURL(/\/admin\/bookings/)
  await expect(page.getByRole('button', { name: new RegExp(reference) })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Bookings', exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: /new$/ })).toHaveCount(0)
  await guestContext.close()
})
