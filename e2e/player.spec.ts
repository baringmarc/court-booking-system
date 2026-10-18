// A player signs up (confirming the email, as on the hosted project), books with prefilled details,
// and reads the booking as its owner (no token).
import { expect, test } from '@playwright/test'
import { confirmationLink, E2E_PREFIX, PASSWORD, pickFirstFreeSlot, uniqueEmail, venueDate } from './support/helpers.ts'

test('a signed-in player books with prefilled details and sees it without a token', async ({ page }) => {
  const email = uniqueEmail('player')
  await page.goto('/signup')
  await page.getByLabel('Full name').fill(`${E2E_PREFIX} Player`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign up' }).click()

  // No session until the email is confirmed.
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(0)
  await page.goto(await confirmationLink(email))
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()

  await pickFirstFreeSlot(page, { date: venueDate(9), sport: 'tennis', court: 'Tennis Court' })
  await expect(page.getByLabel('Name')).toHaveValue(`${E2E_PREFIX} Player`)
  await expect(page.getByLabel('Email')).toHaveValue(email)
  await expect(page.getByLabel('Email')).toHaveAttribute('readonly', '')
  await page.getByRole('button', { name: 'Confirm booking' }).click()

  await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
  await expect(page).toHaveURL(/\/booking\/CB-[A-Z0-9]{6}$/)
  await expect(page.getByRole('heading', { name: 'Save this link' })).toHaveCount(0)

  // Reload: the owner path (RLS) still finds it without any token.
  const reference = new URL(page.url()).pathname.split('/').pop()!
  await page.reload()
  // The reference sits in the booking facts (a <dd>) and again in the payment note; check the facts.
  await expect(page.getByRole('definition').filter({ hasText: reference })).toBeVisible()
  await expect(page.getByRole('definition').filter({ hasText: `${E2E_PREFIX} Player` })).toBeVisible()
  await expect(page.getByText('Waiting for payment')).toBeVisible()
})
