// A player signs up (confirming the email, as on the hosted project), books with prefilled details,
// and reads the booking as its owner (no token).
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { confirmationLink, E2E_PREFIX, PASSWORD, pickFirstFreeSlot, serviceClient, uniqueEmail, venueDate } from './support/helpers.ts'

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

// T27.1: the selection bar already shows the payable total, and checkout shows the same one.
// Creates no data; it sets the platform booking fee for its own run (workers: 1) and puts it back to 0.
test.describe('selection bar total', () => {
  const FEE = 10

  test.beforeAll(async () => {
    await serviceClient().from('platform_pricing').update({ booking_fee: FEE }).eq('id', true).throwOnError()
  })
  test.afterAll(async () => {
    await serviceClient().from('platform_pricing').update({ booking_fee: 0 }).eq('id', true).throwOnError()
  })

  test('the selection bar total equals the Total on checkout, and /book with a selection is axe clean', async ({ page }) => {
    await page.goto(`/book?date=${venueDate(9)}&sport=tennis`)
    const slot = page.getByRole('button', { name: /^Tennis Court, .*₱/ }).first()
    await expect(slot).toBeVisible()
    const label = (await slot.getAttribute('aria-label')) ?? ''
    const price = Number(label.match(/₱([\d,]+(?:\.\d+)?)$/)?.[1].replaceAll(',', ''))
    expect(price).toBeGreaterThan(0)
    await slot.click()
    await expect(slot).toHaveAttribute('aria-pressed', 'true')

    const peso = (amount: number) =>
      new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount)
    const bar = page.getByRole('region', { name: 'Your selection' })
    await expect(bar).toBeVisible()
    await expect(bar).toContainText(`Court ${peso(price)} + booking fee ${peso(FEE)} = ${peso(price + FEE)}`)
    const amounts = (await bar.innerText()).match(/₱[\d,]+(?:\.\d+)?/g) ?? []
    const barTotal = amounts.at(-1)!
    expect(barTotal).toBe(peso(price + FEE))

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])

    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible()
    const total = page.locator('dt', { hasText: /^Total$/ }).locator('xpath=following-sibling::dd[1]')
    await expect(total).toHaveText(barTotal)
  })
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
