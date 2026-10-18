// Cancelling (SPEC §4): a guest cancels from their private link and the slot is free again;
// an admin cancels with a reason that the guest then sees.
import { expect, test, type Page } from '@playwright/test'
import { createAdmin, E2E_PREFIX, logInAdmin, pickFirstFreeSlot, venueDate } from './support/helpers.ts'

async function bookAsGuest(page: Page, { date, court }: { date: string; court: string }) {
  const slot = await pickFirstFreeSlot(page, { date, sport: 'badminton', court })
  await page.getByLabel('Name').fill(`${E2E_PREFIX} Canceller`)
  await page.getByLabel('Email').fill(`e2e-cancel-${Date.now()}@example.com`)
  await page.getByLabel('Phone').fill('0917 000 5678')
  await page.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
  const url = page.url()
  return { slot, url, reference: new URL(url).pathname.split('/').pop()! }
}

test('a guest cancels their booking and the slot can be booked again', async ({ page }) => {
  const date = venueDate(11)
  const { slot } = await bookAsGuest(page, { date, court: 'Badminton 2' })

  await page.getByRole('button', { name: 'Cancel booking' }).click()
  await page.getByLabel('Reason (optional)').fill('Plans changed')
  await page.getByRole('button', { name: 'Yes, cancel booking' }).click()

  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible()
  await expect(page.getByText('This booking was cancelled (Plans changed).')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel booking' })).toHaveCount(0)

  // The same slot is offered again on the grid.
  await page.goto(`/book?date=${date}&sport=badminton`)
  await expect(page.getByRole('button', { name: slot })).toBeEnabled()
})

test('an admin cancels a booking with a reason the guest sees', async ({ page, browser }) => {
  const date = venueDate(12)
  const { url, reference } = await bookAsGuest(page, { date, court: 'Badminton 3' })

  const admin = await createAdmin()
  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await logInAdmin(adminPage, admin.email, admin.password, `/admin/bookings?status=all&date=${date}`)
  await adminPage.getByRole('button', { name: new RegExp(reference) }).click()

  const form = adminPage.getByRole('form', { name: 'Cancel booking' })
  await form.getByRole('button', { name: 'Cancel booking' }).click()
  await expect(form.getByText('Give a reason so the player knows why.')).toBeVisible()
  await form.getByLabel('Reason for cancelling').fill('Court maintenance')
  await form.getByRole('button', { name: 'Cancel booking' }).click()
  await expect(adminPage.getByRole('status').filter({ hasText: `${reference} is cancelled` })).toBeVisible()
  await adminContext.close()

  await page.goto('about:blank')
  await page.goto(url)
  await expect(page.getByText('The venue cancelled this booking: Court maintenance')).toBeVisible()
})
