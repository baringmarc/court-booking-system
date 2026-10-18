// SPEC §5.7: a guest books, later signs up with the same email and confirms it, and the booking
// appears in My bookings (the claim runs after sign-in).
import { expect, test } from '@playwright/test'
import { confirmationLink, E2E_PREFIX, PASSWORD, pickFirstFreeSlot, uniqueEmail, venueDate } from './support/helpers.ts'

test('a guest booking shows up in My bookings after signing up with the same email', async ({ page }) => {
  const email = uniqueEmail('claim')
  await pickFirstFreeSlot(page, { date: venueDate(13), sport: 'badminton', court: 'Badminton 4' })
  await page.getByLabel('Name').fill(`${E2E_PREFIX} Claimer`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Phone').fill('0917 000 4321')
  await page.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
  const reference = new URL(page.url()).pathname.split('/').pop()!

  await page.goto('/signup')
  await page.getByLabel('Full name').fill(`${E2E_PREFIX} Claimer`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign up' }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  await page.goto(await confirmationLink(email))
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()

  await page.getByRole('link', { name: 'My bookings' }).click()
  await expect(page.getByText('We added 1 earlier booking made with your email.')).toBeVisible()
  const upcoming = page.getByRole('list', { name: 'Upcoming bookings' })
  await upcoming.getByRole('link', { name: new RegExp(reference) }).click()

  // As the owner now, the booking opens without the guest token.
  await expect(page).toHaveURL(new RegExp(`/booking/${reference}$`))
  await expect(page.getByRole('definition').filter({ hasText: reference })).toBeVisible()
})
