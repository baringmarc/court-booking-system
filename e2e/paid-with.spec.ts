// T11.28: "Paid with" on the proof form lists the venue's payment accounts. A guest picks an E2E account, uploads a
// proof, and the admin sees that account's label in the review panel. Accessible and usable at 360px.
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { axeBothSchemes, createAdmin, E2E_PREFIX, logInAdmin, pickFirstFreeSlot, receiptPng, serviceClient, venueDate, venueId } from './support/helpers.ts'

const LABEL = `${E2E_PREFIX} Paid With Bank`
const OTHER = `${E2E_PREFIX} Paid With Other`

async function removeTaggedAccounts() {
  await serviceClient().from('venue_payment_accounts').delete().like('label', `${E2E_PREFIX}%`).throwOnError()
}

test.beforeEach(removeTaggedAccounts)
test.afterEach(removeTaggedAccounts)

test('a guest pays with a payment account and the admin sees its label in the review panel', async ({ page, browser }) => {
  const service = serviceClient()
  const { count } = await service.from('venue_payment_accounts').select('id', { count: 'exact', head: true })
  test.skip((count ?? 0) >= 9, 'the local venue already lists too many payment accounts for two more')
  const venue = await venueId()
  // Two accounts, so the guest has to choose one (a single account is chosen from the start).
  await service.from('venue_payment_accounts').insert([
    { venue_id: venue, label: LABEL, account_name: 'Claudex Courts', account_number: '0917 000 3333', position: 98 },
    { venue_id: venue, label: OTHER, account_name: 'Other Name', account_number: '0917 000 4444', position: 99 },
  ]).throwOnError()

  await pickFirstFreeSlot(page, { date: venueDate(12), sport: 'pickleball', court: 'Pickleball 2' })
  await page.getByLabel('Name').fill(`${E2E_PREFIX} Paid With Guest`)
  await page.getByLabel('Email').fill(`e2e-paidwith-${Date.now()}@example.com`)
  await page.getByRole('button', { name: 'Reserve and continue to payment' }).click()
  await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
  const reference = new URL(page.url()).pathname.split('/').pop()!

  // The select lists accounts by label (and not the old fixed list, since the venue has accounts).
  const select = page.getByLabel('Paid with', { exact: true })
  await expect(select.getByRole('option', { name: LABEL })).toHaveCount(1)
  await expect(select.getByRole('option', { name: 'Bank transfer' })).toHaveCount(0)
  // T27.4: the card's "Pay with" button sets the select, without touching it.
  await expect(select.locator('option:checked')).toHaveText('Choose…')
  await expect(page.getByText('0917 000 3333')).toHaveCount(0)
  await page.getByRole('button', { name: `Pay with ${LABEL}` }).click()
  await expect(select.locator('option:checked')).toHaveText(LABEL)
  const chosen = page.getByRole('article', { name: LABEL })
  await expect(chosen.getByText('0917 000 3333')).toBeVisible()
  await expect(chosen.getByRole('button', { pressed: true })).toHaveText('Selected')
  await expect(page.getByRole('article', { name: OTHER }).getByText('0917 000 4444')).toHaveCount(0)
  expect(await axeBothSchemes(page, '.payment-accounts')).toEqual([])
  await page.getByLabel(/Receipt screenshot/).setInputFiles(receiptPng())
  expect(await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
  expect(await axeBothSchemes(page, 'form[aria-label="Upload proof of payment"]')).toEqual([])
  await page.getByRole('button', { name: 'Submit proof of payment' }).click()
  await expect(page.getByText(/The venue checks payments by hand/)).toBeVisible()
  // The guest's payment history names the account too.
  await expect(page.getByText(new RegExp(`${LABEL} · `))).toBeVisible()

  // Stored with the account label snapshot.
  const { data: payment } = await service.from('payments').select('paid_with, bookings!inner(reference_code)')
    .eq('bookings.reference_code', reference).single().throwOnError()
  expect(payment.paid_with).toBe(LABEL)

  const admin = await createAdmin()
  const adminContext = await browser.newContext({ ...test.info().project.use })
  const adminPage = await adminContext.newPage()
  await logInAdmin(adminPage, admin.email, admin.password, '/admin/bookings')
  await adminPage.getByRole('button', { name: new RegExp(reference) }).click()
  const panel = adminPage.getByRole('region', { name: `Booking ${reference}` })
  await expect(panel).toBeVisible()
  await expect(panel.getByText(new RegExp(`${LABEL} · ₱`))).toBeVisible()
  expect(await adminPage.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
  expect(await axeBothSchemes(adminPage, `[aria-label="Booking ${reference}"]`)).toEqual([])
  await adminContext.close()
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
