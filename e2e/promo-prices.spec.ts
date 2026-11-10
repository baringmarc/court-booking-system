// T19.3: players see promo prices. An admin adds a promo through the Promos tab; a guest sees its label and price on
// the slot, in the selection bar and at checkout, books it, and the booking's court price is the promo price. When the
// promo ends the slot shows the normal price again. Own E2E venue (court rate ₱700, open 6 AM-10 PM every day), deleted
// afterwards: bookings, then promo links, promos, and the venue. Desktop and 360px.
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { addVenueStaff, axeBothSchemes, createPlayer, createVenue, deleteVenue, E2E_PREFIX, pickDate, serviceClient, submitAdminLogin, venueDate } from './support/helpers.ts'

type E2EVenue = Awaited<ReturnType<typeof createVenue>>
let venue: E2EVenue | undefined

const LABEL = 'E2E promo prices'
const date = venueDate(1)
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

test.beforeEach(async () => {
  venue = await createVenue('promoprice')
})

test.afterEach(async () => {
  if (!venue) return
  const service = serviceClient()
  // Foreign-key order: bookings (payments cascade), promo links, promos, then the venue.
  for (const table of ['bookings', 'court_promo_courts', 'court_promos'] as const) {
    const { error } = await service.from(table).delete().eq('venue_id', venue.id)
    if (error) throw error
  }
  const id = venue.id
  await deleteVenue(id)
  venue = undefined
  for (const table of ['bookings', 'court_promos', 'courts', 'venues'] as const) {
    const { data, error } = await service.from(table).select('id').eq(table === 'venues' ? 'id' : 'venue_id', id)
    if (error) throw error
    expect(data, `${table} removed`).toHaveLength(0)
  }
})

test('a promo set by an admin shows on the slot, at checkout and on the booking; ending it restores the normal price', async ({ page, browser }) => {
  // Admin adds the promo through the form: every day, 10 AM to 12 PM, ₱500 against the ₱700 rate.
  const staff = await createPlayer('promoprice')
  await addVenueStaff(venue!.id, staff.id)
  await page.goto(`${venue!.url}/admin/schedule?tab=promos`)
  await submitAdminLogin(page, staff.email, staff.password)
  await expect(page.getByRole('heading', { level: 2, name: 'Promos' })).toBeVisible()
  await page.getByRole('button', { name: 'Add promo' }).click()
  const form = page.getByRole('form', { name: 'Promo' })
  await expect(form).toBeVisible()
  await form.getByLabel('Promo name').fill(LABEL)
  await form.getByRole('group', { name: 'Starts on' }).getByRole('button', { name: 'Today' }).click()
  await pickDate(page, form, 'Ends on', venueDate(5))
  for (const day of DAYS) await form.getByRole('group', { name: 'Days' }).getByRole('checkbox', { name: day }).check()
  await form.getByRole('group', { name: 'Courts' }).getByRole('checkbox', { name: venue!.court }).check()
  await form.getByLabel('From', { exact: true }).selectOption({ label: '10 AM' })
  await form.getByLabel('Until', { exact: true }).selectOption({ label: '12 PM' })
  await form.getByLabel('Price per hour').fill('500')
  await page.getByRole('button', { name: 'Save promo' }).click()
  await expect(page.getByRole('form', { name: 'Promo' })).toHaveCount(0)
  await expect(page.getByRole('listitem').filter({ hasText: LABEL })).toBeVisible()

  // A guest in their own browser session (same device as the project).
  const guestContext = await browser.newContext({ ...test.info().project.use })
  const guest = await guestContext.newPage()
  await guest.goto(`${venue!.url}/book?date=${date}&sport=tennis`)
  const promoSlot = guest.getByRole('button', { name: `${venue!.court}, 10 AM – 11 AM, ₱500, promo: ${LABEL}` })
  await expect(promoSlot).toBeVisible()
  await expect(promoSlot).toContainText('₱500')
  await expect(promoSlot).toContainText(LABEL)
  // Outside the promo hours the price is the normal rate and there is no label.
  const normal = guest.getByRole('button', { name: `${venue!.court}, 12 PM – 1 PM, ₱700` })
  await expect(normal).toBeVisible()
  await expect(normal).not.toContainText(/promo/i)
  expect(await axeBothSchemes(guest), 'grid with a promo').toEqual([])

  await promoSlot.click()
  const bar = guest.getByRole('region', { name: 'Your selection' })
  await expect(bar).toContainText(`Promo: ${LABEL}`)
  await expect(bar).toContainText('₱500')
  await guest.getByRole('button', { name: 'Continue' }).click()
  await expect(guest.getByRole('heading', { name: 'Checkout' })).toBeVisible()
  await expect(guest.getByRole('definition').filter({ hasText: LABEL })).toBeVisible()
  await expect(guest.getByRole('term').filter({ hasText: /^Promo$/ })).toBeVisible()
  await expect(guest.getByRole('term').filter({ hasText: 'Court price' }).locator('..')).toContainText('₱500')
  expect(await axeBothSchemes(guest), 'checkout with a promo').toEqual([])

  await guest.getByLabel('Name').fill(`${E2E_PREFIX} Promo Guest`)
  await guest.getByLabel('Email').fill(`e2e-promo-${Date.now()}@example.com`)
  await guest.getByLabel('Mobile number (optional)').fill('0917 000 1357')
  await guest.getByLabel('I have read and accept the waiver').check()
  await guest.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(guest.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
  await expect(guest.getByRole('term').filter({ hasText: 'Court price' }).locator('..')).toContainText('₱500')

  const { data: bookings, error } = await serviceClient().from('bookings').select('total_amount').eq('venue_id', venue!.id)
  if (error) throw error
  expect(bookings).toHaveLength(1)
  expect(Number(bookings![0].total_amount)).toBe(500)

  // The promo ends: after a reload (queries are cached) the 11 AM slot, still free, is back at the normal rate.
  const { error: endError } = await serviceClient().from('court_promos').update({ is_active: false }).eq('venue_id', venue!.id)
  if (endError) throw endError
  await guest.goto('about:blank')
  await guest.goto(`${venue!.url}/book?date=${date}&sport=tennis`)
  const after = guest.getByRole('button', { name: `${venue!.court}, 11 AM – 12 PM, ₱700` })
  await expect(after).toBeVisible()
  await expect(after).not.toContainText(/promo/i)
  await expect(guest.getByRole('button', { name: /promo:/ })).toHaveCount(0)
  await guestContext.close()
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
