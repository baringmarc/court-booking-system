// T33.4, reworked in T33.6 (SPEC §7 `/admin/bookings` "Bookings in a group"; §10 2026-11-25 "Checkout panel"): a multi-court checkout on the booking page, in the admin review queue, in the staff cancel and in My bookings.
// (1) A guest books two badminton courts at different times in one checkout and sees ONE total and ONE proof form on the
// booking page; one proof is uploaded; an admin finds ONE row for the checkout in the review queue, titled with the lead's
// reference, opens ONE "Checkout CB-<lead>" panel and approves it once: both bookings are confirmed. (2) Staff find the
// non-lead court by its reference, whose Manage section opens, and cancel that one court of the confirmed checkout: the other stays confirmed,
// the cancelled one has an owed refund for its own payment only, and the guest's page shows it. (3) A signed-in player
// books two courts and /me/bookings lists ONE entry. Demo venue; every booking carries the E2E guest name and the
// players and admins carry e2e-…@example.com emails, so global teardown removes the bookings (their payments, refunds and
// booking groups with them) and the users; nothing else is created. The platform booking fee is ₱10 for this file's run
// and put back to 0 (workers: 1). Desktop and 360px.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { createAdmin, createPlayer, E2E_PREFIX, logInAdmin, serviceClient, uniqueEmail, uploadProof, venueDate } from './support/helpers.ts'

const FEE = 10

/** As the app shows money (src/lib/format.ts formatMoney): no centavos on whole pesos. */
const peso = (amount: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount)

/** The court price from a free slot's accessible name ("Badminton 1, 10 AM – 11 AM, ₱350"). */
function slotPrice(name: string) {
  const match = name.match(/₱([\d,]+(?:\.\d+)?)$/)
  if (!match) throw new Error(`No price in slot name: ${name}`)
  return Number(match[1].replaceAll(',', ''))
}

/** The free (priced) slot buttons of a court on /book, in page order. */
const freeSlots = (page: Page, court: string) => page.getByRole('button', { name: new RegExp(`^${court}, .*₱`) })

async function pick(page: Page, slot: ReturnType<typeof freeSlots>) {
  const name = (await slot.getAttribute('aria-label')) ?? ''
  await slot.click()
  await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
  return name
}

async function expectCleanAndFits(page: Page, what: string) {
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'), `${what}: axe`).toEqual([])
  expect(await page.evaluate<boolean>('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), `${what}: no horizontal scroll`).toBe(true)
}

/** Picks Badminton 1 (first free slot) and Badminton 2 (last free slot), so the two bookings differ in court and time. */
async function pickTwoCourts(page: Page, date: string) {
  await page.goto(`/book?date=${date}&sport=badminton`)
  await expect(freeSlots(page, 'Badminton 1').first()).toBeVisible()
  const first = await pick(page, freeSlots(page, 'Badminton 1').first())
  const second = await pick(page, freeSlots(page, 'Badminton 2').last())
  await page.getByRole('region', { name: 'Your selection' }).getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible()
  return slotPrice(first) + slotPrice(second)
}

/** The booking page reads Reference, Court price, Booking fee and Total as facts: the <dd> after the <dt>. */
const fact = (page: Page, label: string) => page.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]')

/** The bookings of the group the booking `reference` belongs to (service client), with each court's name and its payments. */
async function groupOf(reference: string) {
  const service = serviceClient()
  const { data: page } = await service.from('bookings').select('id, booking_group_id').eq('reference_code', reference).single().throwOnError()
  expect(page.booking_group_id, 'the booking is in a group').not.toBeNull()
  const { data: bookings } = await service
    .from('bookings').select('id, reference_code, status, amount_due, court_id, payments(id, amount, review_status, storage_path)')
    .eq('booking_group_id', page.booking_group_id!).throwOnError()
  const { data: courts } = await service.from('courts').select('id, name').in('id', (bookings ?? []).map((b) => b.court_id)).throwOnError()
  const { data: group } = await service.from('booking_groups').select('id, lead_booking_id').eq('id', page.booking_group_id!).single().throwOnError()
  return {
    pageBookingId: page.id,
    bookings: (bookings ?? []).map((b) => ({ ...b, courtName: courts?.find((c) => c.id === b.court_id)?.name ?? '' })),
    group,
  }
}

// Guest links keep the token in the fragment: leave the page first, as opening the saved link from elsewhere does.
async function openGuestLink(page: Page, url: string) {
  await page.goto('about:blank')
  await page.goto(url)
}

test.describe.serial('a guest pays a two-court checkout and staff review and cancel it', () => {
  test.beforeAll(async () => {
    await serviceClient().from('platform_pricing').update({ booking_fee: FEE }).eq('id', true).throwOnError()
  })
  test.afterAll(async () => {
    await serviceClient().from('platform_pricing').update({ booking_fee: 0 }).eq('id', true).throwOnError()
  })

  let bookingUrl = ''
  let leadReference = ''
  let courtTotal = 0

  test('the guest sees one checkout with one total and one proof form; staff approve it once and both courts are confirmed', async ({ page, browser }) => {
    test.setTimeout(180_000)
    courtTotal = await pickTwoCourts(page, venueDate(16))
    await page.getByLabel('Name').fill(`${E2E_PREFIX} Multi Guest`)
    await page.getByLabel('Email').fill(uniqueEmail('multi-admin'))
    await page.getByRole('button', { name: 'Reserve and continue to payment' }).click()
    await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
    await expect(page).toHaveURL(/\/booking\/CB-[A-Z0-9]{6}#token=/)
    bookingUrl = page.url()
    leadReference = new URL(bookingUrl).pathname.split('/').pop()!

    // The booking page: the whole checkout, one total, one payment path.
    await expect(page.getByRole('heading', { name: 'Your courts', level: 2 })).toBeVisible()
    const courts = page.getByRole('list', { name: 'Courts in this booking' }).getByRole('listitem')
    await expect(courts).toHaveCount(2)
    await expect(courts.filter({ hasText: 'Badminton 1' })).toHaveCount(1)
    await expect(courts.filter({ hasText: 'Badminton 2' })).toHaveCount(1)
    await expect(fact(page, 'Court price')).toHaveText(peso(courtTotal))
    await expect(fact(page, 'Booking fee')).toHaveText(peso(FEE))
    await expect(fact(page, 'Total')).toHaveText(peso(courtTotal + FEE))
    await expect(page.getByText('Waiting for payment', { exact: true })).toHaveCount(1)
    await expect(page.getByRole('form', { name: 'Upload proof of payment' })).toHaveCount(1)
    await expect(page.getByLabel('Amount paid')).toHaveValue(String(courtTotal + FEE))
    await expectCleanAndFits(page, 'booking page of a two-court checkout')

    await uploadProof(page)
    await expect(page.getByText('Payment under review')).toBeVisible()

    // One payment per court, split by amount due, the file only on the booking the proof was sent from.
    const { pageBookingId, bookings, group } = await groupOf(leadReference)
    expect(bookings).toHaveLength(2)
    expect(group.lead_booking_id).toBe(pageBookingId)
    expect(bookings.every((b) => b.status === 'payment_submitted')).toBe(true)
    const payments = bookings.flatMap((b) => b.payments)
    expect(payments).toHaveLength(2)
    expect(payments.reduce((sum, p) => sum + Number(p.amount), 0)).toBe(courtTotal + FEE)
    expect(payments.filter((p) => p.storage_path !== null)).toHaveLength(1)
    const [refA, refB] = bookings.map((b) => b.reference_code)

    // Staff: ONE row for the checkout in the default review queue.
    const admin = await createAdmin()
    const adminContext = await browser.newContext({ ...test.info().project.use })
    const adminPage = await adminContext.newPage()
    try {
      await logInAdmin(adminPage, admin.email, admin.password, '/admin/bookings')
      // The row is titled with the lead's reference (what the player was told to put in the payment note), never the other court's.
      const otherRef = refA === leadReference ? refB : refA
      const row = adminPage.getByRole('button', { name: new RegExp(`${refA}|${refB}`) })
      await expect(row).toHaveCount(1)
      await expect(row).toContainText(leadReference)
      await expect(row).not.toContainText(otherRef)
      await expect(row).toContainText('2 bookings')
      await expect(row).toContainText(peso(courtTotal + FEE))
      await row.click()

      // One panel for the whole checkout; opened from the queue, no court is open.
      const panel = adminPage.getByRole('region', { name: `Checkout ${leadReference}` })
      await expect(panel.getByRole('heading', { level: 2, name: `Checkout ${leadReference}` })).toBeVisible()
      await expect(adminPage.getByRole('region', { name: /^Booking CB-/ })).toHaveCount(0)
      const courtsList = panel.getByRole('list', { name: 'Bookings in this checkout' })
      await expect(courtsList.getByRole('listitem')).toHaveCount(2)
      await expect(courtsList.getByRole('link')).toHaveCount(0)
      await expect(courtsList.getByRole('button', { name: `Manage ${otherRef}` })).toHaveAttribute('aria-expanded', 'false')
      await expect(courtsList.getByRole('button', { name: `Manage ${leadReference}`, exact: true })).toHaveAttribute('aria-expanded', 'false')
      await expect(panel.getByText('Customer', { exact: true })).toBeVisible()
      await expect(adminPage.getByRole('form', { name: 'Cancel booking' })).toHaveCount(0)
      await expect(panel.getByText('Checkout total', { exact: true })).toBeVisible()
      await expect(panel.getByRole('heading', { name: 'Proof waiting for review' })).toHaveCount(1)
      await expect(panel.getByRole('img', { name: 'Proof of payment' })).toBeVisible()
      await expect(panel.getByText('This decides all 2 bookings at once.')).toBeVisible()
      await expectCleanAndFits(adminPage, 'admin review panel of a checkout')

      // One decision confirms both courts.
      await panel.getByRole('button', { name: 'Approve and confirm' }).click()
      await expect(adminPage.getByRole('status').filter({ hasText: `Checkout ${leadReference} is confirmed (2 bookings).` })).toBeVisible()
      const after = await groupOf(leadReference)
      expect(after.bookings.map((b) => b.status)).toEqual(['confirmed', 'confirmed'])
      expect(after.bookings.flatMap((b) => b.payments).map((p) => p.review_status)).toEqual(['approved', 'approved'])
    } finally {
      await adminContext.close()
    }

    // The guest's page: Confirmed, both courts.
    await openGuestLink(page, bookingUrl)
    await expect(page.getByRole('heading', { name: 'Your courts', level: 2 })).toBeVisible()
    await expect(page.locator('.badge.status-confirmed')).toHaveCount(1)
    await expect(page.getByRole('list', { name: 'Courts in this booking' }).getByRole('listitem')).toHaveCount(2)
    await expect(page.getByRole('form', { name: 'Upload proof of payment' })).toHaveCount(0)
  })

  test('staff cancel one court of the confirmed checkout: the other stays confirmed and the cancelled one is owed its own refund', async ({ page, browser }) => {
    test.setTimeout(150_000)
    const { bookings, group } = await groupOf(leadReference)
    // Cancel the court that is not the lead, so its refund is its own payment without the booking fee.
    const cancelled = bookings.find((b) => b.id !== group.lead_booking_id)!
    const kept = bookings.find((b) => b.id === group.lead_booking_id)!
    const cancelledName = cancelled.courtName
    const ownPayment = Number(cancelled.payments[0].amount)

    const admin = await createAdmin()
    const adminContext = await browser.newContext({ ...test.info().project.use })
    const adminPage = await adminContext.newPage()
    try {
      // A search for the non-lead court's reference opens its checkout with that court's Manage section open.
      await logInAdmin(adminPage, admin.email, admin.password, `/admin/bookings?status=all&q=${cancelled.reference_code}`)
      const panel = adminPage.getByRole('region', { name: `Checkout ${leadReference}` })
      await expect(panel.getByRole('button', { name: `Manage ${cancelled.reference_code}` })).toHaveAttribute('aria-expanded', 'true')
      await expect(panel.getByRole('button', { name: `Manage ${kept.reference_code}`, exact: true })).toHaveAttribute('aria-expanded', 'false')
      const form = panel.getByRole('form', { name: 'Cancel booking' })
      await expect(form.getByText('Only this booking is cancelled. The other booking in this checkout stays booked.')).toBeVisible()
      await expectCleanAndFits(adminPage, 'staff cancel form of a checkout')
      await form.getByLabel('Reason for cancelling').fill('Court maintenance')
      await form.getByRole('button', { name: 'Cancel booking' }).click()
      await expect(adminPage.getByRole('status').filter({
        hasText: `${cancelled.reference_code} (${cancelledName}) is cancelled and the slot released. The other bookings stay booked.`,
      })).toBeVisible()
    } finally {
      await adminContext.close()
    }

    const service = serviceClient()
    const { data: rows } = await service.from('bookings').select('id, status').in('id', [cancelled.id, kept.id]).throwOnError()
    expect(rows?.find((r) => r.id === kept.id)?.status).toBe('confirmed')
    expect(rows?.find((r) => r.id === cancelled.id)?.status).toBe('cancelled')
    const { data: refunds } = await service.from('refunds').select('booking_id, payment_id, amount, status').in('booking_id', [cancelled.id, kept.id]).throwOnError()
    expect(refunds).toHaveLength(1)
    expect(refunds![0]).toMatchObject({ booking_id: cancelled.id, status: 'owed' })
    expect(Number(refunds![0].amount)).toBe(ownPayment)

    // The guest: the cancelled court is badged, the group stays Confirmed, and the court's refund has its own card.
    await openGuestLink(page, bookingUrl)
    const items = page.getByRole('list', { name: 'Courts in this booking' }).getByRole('listitem')
    await expect(items).toHaveCount(2)
    await expect(items.filter({ hasText: cancelledName }).getByText('Cancelled')).toBeVisible()
    await expect(items.filter({ hasText: kept.courtName }).getByText('Cancelled')).toHaveCount(0)
    await expect(page.locator('.badge.status-confirmed')).toHaveCount(1)
    await expect(page.getByRole('status').filter({ hasText: `The venue cancelled ${cancelledName}` })).toContainText('Your other bookings are still confirmed.')
    await expect(page.getByRole('region', { name: `Refund: ${cancelledName}` })).toContainText(`The venue owes you a refund of ${peso(ownPayment)}`)
    await expectCleanAndFits(page, 'booking page after one court was cancelled')
  })
})

test('a signed-in player books two courts and My bookings lists one entry for them', async ({ page }) => {
  test.setTimeout(120_000)
  await serviceClient().from('platform_pricing').update({ booking_fee: FEE }).eq('id', true).throwOnError()
  try {
    const player = await createPlayer('multi-me')
    await page.goto('/login')
    await page.getByLabel('Email').fill(player.email)
    await page.getByLabel('Password').fill(player.password)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()

    const courtTotal = await pickTwoCourts(page, venueDate(17))
    await page.getByLabel('Name').fill(`${E2E_PREFIX} Multi Player`)
    await page.getByRole('button', { name: 'Reserve and continue to payment' }).click()
    await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
    const reference = new URL(page.url()).pathname.split('/').pop()!
    // The owner path (no token) shows the whole checkout too.
    await expect(page.getByRole('heading', { name: 'Your courts', level: 2 })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Courts in this booking' }).getByRole('listitem')).toHaveCount(2)
    await expect(fact(page, 'Total')).toHaveText(peso(courtTotal + FEE))
    const { bookings } = await groupOf(reference)
    expect(bookings).toHaveLength(2)

    await page.goto('/me/bookings')
    const upcoming = page.getByRole('list', { name: 'Upcoming bookings' })
    const entries = upcoming.getByRole('link')
    await expect(entries).toHaveCount(1)
    await expect(entries).toContainText('2 bookings')
    for (const b of bookings) await expect(entries).toContainText(b.reference_code)
    await expect(entries).toContainText(peso(courtTotal + FEE))
    await expect(entries).toContainText('Waiting for payment')
    await expectCleanAndFits(page, 'My bookings with a group')

    // The entry opens the lead's page: the whole checkout again.
    await entries.click()
    await expect(page).toHaveURL(/\/booking\/CB-[A-Z0-9]{6}$/)
    await expect(page.getByRole('heading', { name: 'Your courts', level: 2 })).toBeVisible()
  } finally {
    await serviceClient().from('platform_pricing').update({ booking_fee: 0 }).eq('id', true).throwOnError()
  }
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
