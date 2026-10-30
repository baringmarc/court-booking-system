// T11.30: the non-final rejection email carries "Upload a new proof", a fresh private link. Following it WITHOUT the
// original link opens the booking with focus on the pay heading; the guest uploads again and the admin approves.
import { expect, test } from '@playwright/test'
import { axeBothSchemes, createAdmin, E2E_PREFIX, emailText, logInAdmin, pickFirstFreeSlot, runEmailWorker, uploadProof, venueDate } from './support/helpers.ts'

// The email link's origin is the site URL (localhost:5173), not the e2e server: open its path and hash on baseURL.
function relative(link: string) {
  const url = new URL(link)
  return url.pathname + url.hash
}

test('a guest re-uploads a proof through the link in the rejection email', async ({ page, browser }) => {
  await pickFirstFreeSlot(page, { date: venueDate(13), sport: 'pickleball', court: 'Pickleball 2' })
  await page.getByLabel('Name').fill(`${E2E_PREFIX} Reupload Guest`)
  const guestEmail = `e2e-reupload-${Date.now()}@example.com`
  await page.getByLabel('Email').fill(guestEmail)
  await page.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
  const reference = new URL(page.url()).pathname.split('/').pop()!
  await uploadProof(page)

  // The admin rejects (non-final: the guest keeps the slot).
  const admin = await createAdmin()
  const adminContext = await browser.newContext({ ...test.info().project.use })
  const adminPage = await adminContext.newPage()
  await logInAdmin(adminPage, admin.email, admin.password, '/admin/bookings')
  const openInQueue = async () => {
    await adminPage.goto('/admin/bookings')
    await adminPage.getByRole('button', { name: new RegExp(reference) }).click()
    await expect(adminPage.getByRole('region', { name: `Booking ${reference}` })).toBeVisible()
  }
  await openInQueue()
  await adminPage.getByLabel('Reason for rejecting').fill('Screenshot is cut off')
  await adminPage.getByRole('button', { name: 'Reject proof' }).click()
  await expect(adminPage.getByRole('status').filter({ hasText: 'proof rejected' })).toBeVisible()

  // The email has the fresh link.
  await runEmailWorker()
  const mail = await emailText(guestEmail, new RegExp(`^Booking ${reference}: please upload a new proof$`))
  expect(mail).toContain('Upload a new proof')
  const link = mail.match(new RegExp(`https?://\\S+/booking/${reference}#token=[A-Za-z0-9_%-]+`))?.[0]
  expect(link, 'private link in the rejection email').toBeTruthy()

  // A new browser context has no memory of the original link.
  const fresh = await browser.newContext({ ...test.info().project.use })
  const guest = await fresh.newPage()
  await guest.goto(relative(link!))
  await expect(guest.getByText(reference).first()).toBeVisible()
  await expect(guest.getByRole('alert')).toContainText('Your last proof was not accepted: Screenshot is cut off')
  await expect(guest.getByRole('heading', { name: /Pay within/ })).toBeFocused()
  expect(await guest.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
  expect(await axeBothSchemes(guest)).toEqual([])

  await uploadProof(guest)
  await openInQueue()
  await adminPage.getByRole('button', { name: 'Approve and confirm' }).click()
  await expect(adminPage.getByRole('status').filter({ hasText: `${reference} is confirmed` })).toBeVisible()
  await guest.goto('about:blank')
  await guest.goto(relative(link!))
  await expect(guest.getByText('Confirmed', { exact: true })).toBeVisible()
  await fresh.close()
  await adminContext.close()
})
