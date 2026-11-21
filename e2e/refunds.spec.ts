// T30.6: refund status (SPEC §4). A guest pays by proof and the admin approves it; the admin then cancels the booking,
// which records an owed refund. The admin finds it on the dashboard and in the bookings list and filter, marks it
// refunded (with validation), reopens it, marks it not refunded with a reason, and settles it again. The player's
// booking page then says how it was refunded. The booking carries the E2E tag, and refunds go with it (they cascade
// from bookings and payments), so global teardown removes everything this file creates.
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { axeBothSchemes, createAdmin, E2E_PREFIX, logInAdmin, pickFirstFreeSlot, uploadProof, venueDate } from './support/helpers.ts'

// A string, because the e2e tsconfig has no DOM types.
const NO_SIDEWAYS_SCROLL = 'document.documentElement.scrollWidth <= window.innerWidth'

test('an admin cancels a paid booking, settles the refund, and the player sees it', async ({ page, browser }) => {
  test.setTimeout(150_000)
  const date = venueDate(14)

  // The guest books a free badminton slot and uploads a proof.
  await pickFirstFreeSlot(page, { date, sport: 'badminton', court: 'Badminton 3' })
  await page.getByLabel('Name').fill(`${E2E_PREFIX} Refund Guest`)
  await page.getByLabel('Email').fill(`e2e-refund-${Date.now()}@example.com`)
  await page.getByRole('button', { name: 'Reserve and continue to payment' }).click()
  await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
  const url = page.url()
  const reference = new URL(url).pathname.split('/').pop()!
  await uploadProof(page)

  const admin = await createAdmin()
  const adminContext = await browser.newContext({ ...test.info().project.use })
  const adminPage = await adminContext.newPage()
  try {
    // The admin approves the proof, then cancels the confirmed booking with a reason.
    await logInAdmin(adminPage, admin.email, admin.password, `/admin/bookings?status=all&date=${date}`)
    const row = adminPage.getByRole('button', { name: new RegExp(reference) })
    await row.click()
    await adminPage.getByRole('button', { name: 'Approve and confirm' }).click()
    await expect(adminPage.getByRole('status').filter({ hasText: `${reference} is confirmed` })).toBeVisible()
    await row.click()
    const cancelForm = adminPage.getByRole('form', { name: 'Cancel booking' })
    await expect(cancelForm.getByText(/a refund will be recorded for you to settle afterwards/)).toBeVisible()
    await cancelForm.getByLabel('Reason for cancelling').fill('Court maintenance')
    await cancelForm.getByRole('button', { name: 'Cancel booking' }).click()

    // The panel shows the Refund card (not the bare status alert, which stays on the page), and the row says it is owed.
    const card = adminPage.getByRole('region', { name: 'Refund', exact: true })
    await expect(card.locator('.badge')).toHaveText('Refund owed')
    await expect(row).toContainText('Refund owed')
    await expect(adminPage.getByText(/outside the app/)).toHaveCount(0)

    // The dashboard counts it and links to the filtered list.
    await adminPage.goto('/admin')
    const dashboardCard = adminPage.getByRole('heading', { name: 'Refunds owed', level: 2 }).locator('xpath=ancestor::section[1]')
    await expect(dashboardCard.locator('.big-number')).toHaveText(/^[1-9]\d*$/)
    const link = dashboardCard.getByRole('link', { name: 'Open refunds' })
    await expect(link).toHaveAttribute('href', '/admin/bookings?status=all&refund=owed')
    await link.click()
    await expect(adminPage).toHaveURL(/\/admin\/bookings\?status=all&refund=owed$/)

    // The filter lists the booking (other bookings with an owed refund may be there too) and the select shows it.
    await expect(adminPage.getByLabel('Refunds', { exact: true })).toHaveValue('owed')
    await expect(row).toBeVisible()
    await expect(row).toContainText('Refund owed')
    // Settling a refund takes it out of this filter and the page closes its panel, so work from the day's list.
    await adminPage.goto(`/admin/bookings?status=all&date=${date}`)
    await row.click()
    await expect(card.locator('.badge')).toHaveText('Refund owed')

    // Mark refunded with nothing chosen: the method is required.
    await card.getByRole('button', { name: 'Mark refunded' }).click()
    const settleForm = adminPage.getByRole('form', { name: 'Mark refunded' })
    await settleForm.getByRole('button', { name: 'Save refund' }).click()
    await expect(settleForm.getByText('Choose how the refund was made.')).toBeVisible()
    // The card with its form open, and the error showing, is accessible and fits the screen.
    expect(await axeBothSchemes(adminPage, 'section[aria-label="Refund"]')).toEqual([])
    expect(await adminPage.evaluate<boolean>(NO_SIDEWAYS_SCROLL)).toBe(true)

    // Refunded by GCash, with the default date and amount.
    await settleForm.getByLabel('Refunded by').selectOption('gcash')
    await settleForm.getByRole('button', { name: 'Save refund' }).click()
    await expect(card.locator('.badge')).toHaveText('Refunded')
    await expect(card.getByText('GCash', { exact: true })).toBeVisible()
    await expect(adminPage.getByRole('form', { name: 'Mark refunded' })).toHaveCount(0)

    // Reopen it as owed.
    await card.getByRole('button', { name: 'Reopen as owed' }).click()
    await expect(card.locator('.badge')).toHaveText('Refund owed')

    // Not refunded needs a reason.
    await card.getByRole('button', { name: 'Not refunded', exact: true }).click()
    const noRefundForm = adminPage.getByRole('form', { name: 'Not refunded' })
    await noRefundForm.getByRole('button', { name: 'Save as not refunded' }).click()
    await expect(noRefundForm.getByText('Give a reason so the player knows why.')).toBeVisible()
    await noRefundForm.getByLabel('Reason (shown to the player)').fill('E2E court was flooded')
    await noRefundForm.getByRole('button', { name: 'Save as not refunded' }).click()
    await expect(card.locator('.badge')).toHaveText('Not refunded')
    await expect(card.getByText('E2E court was flooded')).toBeVisible()
    expect(await adminPage.evaluate<boolean>(NO_SIDEWAYS_SCROLL)).toBe(true)

    // Settle it again, and open Edit refund to see the saved values.
    await card.getByRole('button', { name: 'Reopen as owed' }).click()
    await expect(card.locator('.badge')).toHaveText('Refund owed')
    await card.getByRole('button', { name: 'Mark refunded' }).click()
    await adminPage.getByRole('form', { name: 'Mark refunded' }).getByLabel('Refunded by').selectOption('gcash')
    await adminPage.getByRole('form', { name: 'Mark refunded' }).getByRole('button', { name: 'Save refund' }).click()
    await expect(card.locator('.badge')).toHaveText('Refunded')
    await card.getByRole('button', { name: 'Edit refund' }).click()
    const editForm = adminPage.getByRole('form', { name: 'Mark refunded' })
    await expect(editForm.getByLabel('Refunded by')).toHaveValue('gcash')
    await editForm.getByRole('button', { name: 'Cancel' }).click()
    await expect(adminPage.getByRole('form', { name: 'Mark refunded' })).toHaveCount(0)
    await expect(card.locator('.badge')).toHaveText('Refunded')

    // The player's booking page says how and when it was refunded, and nothing else about it.
    await page.goto('about:blank')
    await page.goto(url)
    const playerCard = page.getByRole('region', { name: 'Refund', exact: true })
    await expect(playerCard).toContainText(/Refunded ₱[\d,.]+ by GCash on [A-Z][a-z]{2}, [A-Z][a-z]{2} \d+/)
    await expect(page.getByText(/Contact the venue about any refund/)).toHaveCount(0)
    expect(await page.evaluate<boolean>(NO_SIDEWAYS_SCROLL)).toBe(true)
  } finally {
    await adminContext.close()
  }
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
