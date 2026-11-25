// T33.3: a guest books several courts and times in one checkout. Taps pick free slots on any courts and times (touching
// hours on one court merge into one run), checkout lists every run with ONE booking fee, and reserving creates one booking
// per run in one booking group whose lead is the booking the guest lands on. Demo venue, guest data tagged E2E (global
// teardown removes the bookings and their groups); the platform booking fee is ₱10 for this file's run and put back to 0
// (workers: 1). Each flow uses its own date so the flows don't compete for slots; slots are picked from what is free, so
// the second project's run (which finds the first one's bookings) still works. Desktop and 360px.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { E2E_PREFIX, serviceClient, uniqueEmail, venueDate, venueId } from './support/helpers.ts'

const FEE = 10

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

async function openBoard(page: Page, date: string) {
  await page.goto(`/book?date=${date}&sport=badminton`)
  await expect(freeSlots(page, 'Badminton 1').first()).toBeVisible()
}

/** Taps a slot and checks it shows as selected. Returns its accessible name. */
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

async function reserveAsGuest(page: Page) {
  await page.getByLabel('Name').fill(`${E2E_PREFIX} Multi Guest`)
  await page.getByLabel('Email').fill(uniqueEmail('multi'))
  await page.getByRole('button', { name: 'Reserve and continue to payment' }).click()
  await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
  await expect(page).toHaveURL(/\/booking\/CB-[A-Z0-9]{6}/)
  return new URL(page.url()).pathname.split('/').pop()!
}

/** The length of a booking's `during` range, in hours. */
function hoursOf(during: unknown) {
  const [from, to] = String(during).match(/"([^"]+)"/g)!.map((s) => {
    const iso = s.replaceAll('"', '').replace(' ', 'T')
    return Date.parse(/[+-]\d\d$/.test(iso) ? `${iso}:00` : iso)
  })
  return (to - from) / 3_600_000
}

/** The bookings of the group the booking `reference` belongs to, and the group's lead. */
async function groupOf(reference: string) {
  const service = serviceClient()
  const { data: page, error } = await service.from('bookings').select('id, booking_group_id').eq('reference_code', reference).single()
  if (error) throw error
  expect(page.booking_group_id, 'the booking is in a group').not.toBeNull()
  const { data: bookings, error: bookingsError } = await service
    .from('bookings').select('id, court_id, booking_fee, total_amount, during, guest_name').eq('booking_group_id', page.booking_group_id!)
  if (bookingsError) throw bookingsError
  const { data: group, error: groupError } = await service.from('booking_groups').select('id, lead_booking_id').eq('id', page.booking_group_id!).single()
  if (groupError) throw groupError
  return { pageBookingId: page.id, bookings: bookings ?? [], group }
}

test.describe('multi-court checkout', () => {
  test.beforeAll(async () => {
    await serviceClient().from('platform_pricing').update({ booking_fee: FEE }).eq('id', true).throwOnError()
  })
  test.afterAll(async () => {
    await serviceClient().from('platform_pricing').update({ booking_fee: 0 }).eq('id', true).throwOnError()
  })

  test('a guest books Badminton 1 and Badminton 2 at different times in one checkout with one booking fee', async ({ page }) => {
    await openBoard(page, venueDate(10))
    const first = await pick(page, freeSlots(page, 'Badminton 1').first())
    const second = await pick(page, freeSlots(page, 'Badminton 2').last())
    const courtTotal = slotPrice(first) + slotPrice(second)

    const bar = page.getByRole('region', { name: 'Your selection' })
    await expect(bar).toContainText('2 times · 2 courts')
    await expect(bar).toContainText(`Court ${peso(courtTotal)} + booking fee ${peso(FEE)} = ${peso(courtTotal + FEE)}`)
    await expect(bar.getByRole('list', { name: 'Selected times' }).getByRole('listitem')).toHaveCount(2)
    await expectCleanAndFits(page, '/book with two runs')

    await bar.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible()
    const items = page.getByRole('list', { name: 'Courts and times' }).getByRole('listitem')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toContainText('Badminton 1')
    await expect(items.nth(1)).toContainText('Badminton 2')
    await expect(page.getByText('Booking fee', { exact: true })).toHaveCount(1)
    await expect(page.locator('dt', { hasText: /^Court price$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText(peso(courtTotal))
    await expect(page.locator('dt', { hasText: /^Total$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText(peso(courtTotal + FEE))
    await expectCleanAndFits(page, 'multi checkout')

    const reference = await reserveAsGuest(page)
    const { pageBookingId, bookings, group } = await groupOf(reference)
    expect(bookings).toHaveLength(2)
    expect(new Set(bookings.map((b) => b.court_id)).size).toBe(2)
    expect(group.lead_booking_id).toBe(pageBookingId)
    // One booking fee for the whole checkout, carried by the lead; the court prices add up.
    expect(bookings.reduce((sum, b) => sum + Number(b.booking_fee), 0)).toBe(FEE)
    expect(bookings.reduce((sum, b) => sum + Number(b.total_amount), 0)).toBe(courtTotal)
  })

  test('two times on one court in one checkout give two bookings in one group', async ({ page }) => {
    await openBoard(page, venueDate(11))
    await pick(page, freeSlots(page, 'Badminton 3').first())
    await pick(page, freeSlots(page, 'Badminton 3').last())

    const bar = page.getByRole('region', { name: 'Your selection' })
    await expect(bar).toContainText('2 times · 1 court')
    await bar.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible()
    const items = page.getByRole('list', { name: 'Courts and times' }).getByRole('listitem')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toContainText('Badminton 3')
    await expect(items.nth(1)).toContainText('Badminton 3')

    const reference = await reserveAsGuest(page)
    const { pageBookingId, bookings, group } = await groupOf(reference)
    expect(bookings).toHaveLength(2)
    expect(new Set(bookings.map((b) => b.court_id)).size).toBe(1)
    expect(bookings.map((b) => hoursOf(b.during))).toEqual([1, 1])
    expect(group.lead_booking_id).toBe(pageBookingId)
  })

  test('touching hours on one court merge into one booking; a pick elsewhere is a second one', async ({ page }) => {
    await openBoard(page, venueDate(12))
    // The first two hours that touch on Badminton 4 ("10 AM – 11 AM" then "11 AM – 12 PM").
    const names = (await freeSlots(page, 'Badminton 4').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? '')))
    const range = (name: string) => name.match(/^Badminton 4, (.+?) – (.+?), ₱/)!.slice(1, 3)
    const i = names.findIndex((name, n) => n < names.length - 1 && range(name)[1] === range(names[n + 1])[0])
    expect(i, 'two touching free hours on Badminton 4').toBeGreaterThanOrEqual(0)
    const pairPrice = slotPrice(names[i]) + slotPrice(names[i + 1])
    await page.getByRole('button', { name: names[i], exact: true }).click()
    await page.getByRole('button', { name: names[i + 1], exact: true }).click()
    const elsewhere = await pick(page, freeSlots(page, 'Badminton 1').last())

    const bar = page.getByRole('region', { name: 'Your selection' })
    await expect(bar).toContainText('2 times · 2 courts')
    await expect(bar).toContainText('3 hours')
    await bar.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible()
    const items = page.getByRole('list', { name: 'Courts and times' }).getByRole('listitem')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toContainText('Badminton 4')
    await expect(items.nth(0)).toContainText('(2 hours)')
    await expect(items.nth(0)).toContainText(peso(pairPrice))
    await expect(items.nth(1)).toContainText('Badminton 1')
    await expect(items.nth(1)).toContainText('(1 hour)')
    await expect(items.nth(1)).toContainText(peso(slotPrice(elsewhere)))

    const reference = await reserveAsGuest(page)
    const { pageBookingId, bookings, group } = await groupOf(reference)
    expect(bookings).toHaveLength(2)
    const { data: court4, error } = await serviceClient().from('courts').select('id').eq('venue_id', await venueId()).eq('name', 'Badminton 4').single()
    if (error) throw error
    const merged = bookings.find((b) => b.court_id === court4.id)!
    expect(hoursOf(merged.during)).toBe(2)
    expect(hoursOf(bookings.find((b) => b.id !== merged.id)!.during)).toBe(1)
    // The earlier run is the lead, and its booking is the one on the page.
    expect(group.lead_booking_id).toBe(merged.id)
    expect(pageBookingId).toBe(merged.id)
  })
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
