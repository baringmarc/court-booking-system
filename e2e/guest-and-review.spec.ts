// Guest books, pays and uploads a proof; an admin rejects it (the guest re-uploads), then approves it.
// T11.13: with Plotline's booking fee at ₱10, checkout, the booking page, the proof amount, the booking email and the
// review panel all show the court price, the fee and the total (amount due).
import { expect, test, type Locator, type Page } from '@playwright/test'
import { createAdmin, E2E_PREFIX, emailText, logInAdmin, pickFirstFreeSlot, serviceClient, uploadProof, venueDate } from './support/helpers.ts'

const FEE = 10

/** As the app shows money (src/lib/format.ts formatMoney): no centavos on whole pesos. */
const peso = (amount: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount)
/** As the emails show money: always with centavos. */
const emailPeso = (amount: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount)

/** The row of a booking fact ("Court price", "Booking fee", "Total") inside `scope`. */
const fact = (scope: Page | Locator, label: string) => scope.getByText(label, { exact: true }).locator('..')

/** The court price from a free slot's accessible name ("Pickleball 1, 6 AM – 7 AM, ₱350"). */
function slotPrice(name: string) {
  const match = name.match(/₱([\d,]+(?:\.\d+)?)$/)
  if (!match) throw new Error(`No price in slot name: ${name}`)
  return Number(match[1].replaceAll(',', ''))
}

// Guest links keep the token in the fragment. Going to the same URL again would only be a same-document
// hash navigation (no reload), so leave the page first, as opening the saved link from elsewhere does.
async function openGuestLink(page: Page, url: string) {
  await page.goto('about:blank')
  await page.goto(url)
}

test.describe.serial('guest booking and admin review', () => {
  let bookingUrl = ''
  let reference = ''
  let courtPrice = 0

  // The fee is platform-wide: set it for this flow only, and put it back (workers: 1, so nothing else runs meanwhile).
  test.beforeAll(async () => {
    await serviceClient().from('platform_pricing').update({ booking_fee: FEE }).eq('id', true).throwOnError()
  })
  test.afterAll(async () => {
    await serviceClient().from('platform_pricing').update({ booking_fee: 0 }).eq('id', true).throwOnError()
  })

  test('a guest books a court and uploads a proof of payment', async ({ page }) => {
    courtPrice = slotPrice(await pickFirstFreeSlot(page, { date: venueDate(8), sport: 'pickleball', court: 'Pickleball 1' }))

    // Checkout: the court price from the server, the fee and the total.
    await expect(fact(page, 'Court price')).toContainText(peso(courtPrice))
    await expect(fact(page, 'Booking fee')).toContainText(peso(FEE))
    await expect(fact(page, 'Total')).toContainText(peso(courtPrice + FEE))

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

    // The booking snapshots the fee, and the booking page shows the split and asks for the amount due.
    const { data: stored } = await serviceClient().from('bookings').select('total_amount, booking_fee, amount_due')
      .eq('reference_code', reference).single().throwOnError()
    expect([Number(stored.total_amount), Number(stored.booking_fee), Number(stored.amount_due)]).toEqual([courtPrice, FEE, courtPrice + FEE])
    await expect(fact(page, 'Court price')).toContainText(peso(courtPrice))
    await expect(fact(page, 'Booking fee')).toContainText(peso(FEE))
    await expect(fact(page, 'Total')).toContainText(peso(courtPrice + FEE))
    await expect(page.getByText(`Pay ${peso(courtPrice + FEE)} using`, { exact: false })).toBeVisible()
    // The manual proof amount starts at the amount due.
    await expect(page.getByLabel('Amount paid')).toHaveValue(String(courtPrice + FEE))

    // The booking email (SPEC §8) arrives in the local Mailpit with the same private link.
    const mail = await emailText(guestEmail, new RegExp(`^Booking ${reference}: please pay to confirm$`))
    expect(mail).toContain(`/booking/${reference}${new URL(bookingUrl).hash}`)
    expect(mail).toContain(`Court price: ${emailPeso(courtPrice)}`)
    expect(mail).toContain(`Booking fee: ${emailPeso(FEE)}`)
    expect(mail).toContain(`Total: ${emailPeso(courtPrice + FEE)}`)
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

    // Approve the second proof: the booking is confirmed. Staff see the split, and the proof (for the amount due)
    // raises no mismatch warning.
    await openInQueue(adminPage)
    const panel = adminPage.getByRole('region', { name: `Booking ${reference}` })
    await expect(fact(panel, 'Court price')).toContainText(peso(courtPrice))
    await expect(fact(panel, 'Booking fee')).toContainText(peso(FEE))
    await expect(fact(panel, 'Total')).toContainText(peso(courtPrice + FEE))
    await expect(panel.getByText(/but the total is/)).toHaveCount(0)
    await adminPage.getByRole('button', { name: 'Approve and confirm' }).click()
    await expect(adminPage.getByRole('status').filter({ hasText: `${reference} is confirmed` })).toBeVisible()

    await openGuestLink(page, bookingUrl)
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible()
    await expect(page.getByText('Accepted', { exact: true })).toBeVisible()
    await expect(page.getByText('Not accepted', { exact: true })).toBeVisible()
    await adminContext.close()
  })
})
