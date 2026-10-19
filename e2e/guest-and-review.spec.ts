// Guest books, pays and uploads a proof; an admin rejects it (the guest re-uploads), then approves it.
import { expect, test, type Page } from '@playwright/test'
import { createAdmin, E2E_PREFIX, emailText, logInAdmin, pickFirstFreeSlot, uploadProof, venueDate } from './support/helpers.ts'

// Guest links keep the token in the fragment. Going to the same URL again would only be a same-document
// hash navigation (no reload), so leave the page first, as opening the saved link from elsewhere does.
async function openGuestLink(page: Page, url: string) {
  await page.goto('about:blank')
  await page.goto(url)
}

test.describe.serial('guest booking and admin review', () => {
  let bookingUrl = ''
  let reference = ''

  test('a guest books a court and uploads a proof of payment', async ({ page }) => {
    await pickFirstFreeSlot(page, { date: venueDate(8), sport: 'pickleball', court: 'Pickleball 1' })

    await page.getByLabel('Name').fill(`${E2E_PREFIX} Guest`)
    const guestEmail = `e2e-guest-${Date.now()}@example.com`
    await page.getByLabel('Email').fill(guestEmail)
    await page.getByLabel('Phone').fill('0917 000 1234')
    await page.getByRole('button', { name: 'Confirm booking' }).click()

    await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
    // The private token travels in the fragment, which browsers never send to a server.
    await expect(page).toHaveURL(/\/booking\/CB-[A-Z0-9]{6}#token=[A-Za-z0-9_-]+$/)
    await expect(page.getByRole('heading', { name: 'Save this link' })).toBeVisible()
    await expect(page.getByLabel('Private booking link')).toHaveValue(/#token=/)
    await expect(page.getByText('Waiting for payment')).toBeVisible()
    await expect(page.getByRole('timer')).toBeVisible()

    bookingUrl = page.url()
    reference = new URL(bookingUrl).pathname.split('/').pop()!

    // The booking email (SPEC §8) arrives in the local Mailpit with the same private link.
    const mail = await emailText(guestEmail, new RegExp(`^Booking ${reference}: please pay to confirm$`))
    expect(mail).toContain(`/booking/${reference}${new URL(bookingUrl).hash}`)
    await uploadProof(page)
    await expect(page.getByText('Payment under review')).toBeVisible()

    // A link handed out before M5 (?token=) still opens, and the token moves into the fragment.
    const token = new URL(bookingUrl).hash.replace('#token=', '')
    await page.goto(`/booking/${reference}?token=${token}`)
    await expect(page.getByText('Payment under review')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/booking/${reference}#token=${token}$`))
  })

  test('an admin rejects the proof, the guest re-uploads, and the admin approves', async ({ page, browser }) => {
    const admin = await createAdmin()
    const adminContext = await browser.newContext()
    const adminPage = await adminContext.newPage()
    await logInAdmin(adminPage, admin.email, admin.password, '/admin/bookings')

    const openInQueue = async (p: Page) => {
      await p.goto('/admin/bookings')
      await p.getByRole('button', { name: new RegExp(reference) }).click()
      await expect(p.getByRole('region', { name: `Booking ${reference}` })).toBeVisible()
    }

    // Reject with a reason: the guest keeps the slot and sees why.
    await openInQueue(adminPage)
    await expect(adminPage.getByRole('img', { name: 'Proof of payment' })).toBeVisible()
    await adminPage.getByLabel('Reason for rejecting').fill('Screenshot is cut off')
    await adminPage.getByRole('button', { name: 'Reject proof' }).click()
    await expect(adminPage.getByRole('status').filter({ hasText: 'proof rejected' })).toBeVisible()

    await openGuestLink(page, bookingUrl)
    await expect(page.getByRole('alert')).toContainText('Your last proof was not accepted: Screenshot is cut off')
    await uploadProof(page)

    // Approve the second proof: the booking is confirmed.
    await openInQueue(adminPage)
    await adminPage.getByRole('button', { name: 'Approve and confirm' }).click()
    await expect(adminPage.getByRole('status').filter({ hasText: `${reference} is confirmed` })).toBeVisible()

    await openGuestLink(page, bookingUrl)
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible()
    await expect(page.getByText('Accepted', { exact: true })).toBeVisible()
    await expect(page.getByText('Not accepted', { exact: true })).toBeVisible()
    await adminContext.close()
  })
})
