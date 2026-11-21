// T30.4: a confirmed booking's page offers "Same time next week", which opens checkout for the same court and hours
// seven days on with `rebook=<reference>`; reserving there links the new booking to the first (bookings.rebooked_from).
// Runs at desktop and 360px (both Playwright projects).
// Data: the venue's hours are 06:00–22:00 every day (supabase/migrations/20261016162007_catalog.sql), so the first free
// slot on venueDate(12) is also open on venueDate(19). The guest is tagged `E2E…`; both bookings are deleted in
// afterEach (checked), global teardown is the backstop.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { E2E_PREFIX, pickFirstFreeSlot, serviceClient, venueDate } from './support/helpers.ts'

test.afterEach(async () => {
  const service = serviceClient()
  // The newer booking first (it points at the older one; the foreign key is on delete set null, so any order works).
  const newer = await service.from('bookings').delete().like('guest_name', `${E2E_PREFIX}%`).not('rebooked_from', 'is', null)
  if (newer.error) throw newer.error
  const { error } = await service.from('bookings').delete().like('guest_name', `${E2E_PREFIX}%`)
  if (error) throw error
  const left = await service.from('bookings').select('id', { count: 'exact', head: true }).like('guest_name', `${E2E_PREFIX}%`)
  expect(left.count, 'E2E bookings left behind').toBe(0)
})

/** A tstzrange from PostgREST, like ["2030-01-07 09:00:00+00","2030-01-07 10:00:00+00"), as epoch milliseconds. */
function rangeMs(during: unknown) {
  const [start = '', end = ''] = String(during).match(/\d{4}-\d{2}-\d{2} [\d:.]+(?:[+-]\d{2}(?::\d{2})?)?/g) ?? []
  const toMs = (v: string) => Date.parse(v.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'))
  return { start: toMs(start), end: toMs(end) }
}

test('Same time next week on a confirmed booking opens checkout one week on, and the new booking is linked to it', async ({ page }) => {
  await pickFirstFreeSlot(page, { date: venueDate(12), sport: 'pickleball', court: 'Pickleball 1' })
  await page.getByLabel('Name').fill(`${E2E_PREFIX} Rebook Guest`)
  await page.getByLabel('Email').fill(`e2e-rebook-${Date.now()}@example.com`)
  await page.getByRole('button', { name: 'Reserve and continue to payment' }).click()
  await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
  const reference = new URL(page.url()).pathname.split('/').pop()!

  // Confirm it the way an approved payment leaves it (the status is what the page reads).
  const service = serviceClient()
  const { data: first, error } = await service.from('bookings').select('id, court_id, during').eq('reference_code', reference).single()
  if (error) throw error
  const confirmed = await service.from('bookings').update({ status: 'confirmed', expires_at: null }).eq('reference_code', reference)
  if (confirmed.error) throw confirmed.error

  // A guest's link keeps its #token fragment through the reload.
  await page.reload()
  const link = page.getByRole('link', { name: 'Same time next week', exact: true })
  await expect(link).toBeVisible()
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])

  await link.click()
  await expect(page).toHaveURL(/\/book\/checkout\?/)
  const params = new URL(page.url()).searchParams
  const range = rangeMs(first.during)
  const hours = Math.round((range.end - range.start) / 3_600_000)
  expect(params.get('rebook')).toBe(reference)
  expect(params.get('court')).toBe(first.court_id)
  expect(new Date(params.get('start') ?? '').toISOString()).toBe(new Date(range.start + 7 * 86_400_000).toISOString())
  expect(params.get('slots')).toBe(String(hours))
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible()

  await page.getByLabel('Name').fill(`${E2E_PREFIX} Rebook Guest`)
  await page.getByLabel('Email').fill(`e2e-rebook-again-${Date.now()}@example.com`)
  await page.getByRole('button', { name: 'Reserve and continue to payment' }).click()
  await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
  const newReference = new URL(page.url()).pathname.split('/').pop()!
  expect(newReference).not.toBe(reference)

  const { data: second, error: secondError } = await service.from('bookings').select('rebooked_from, court_id, during').eq('reference_code', newReference).single()
  if (secondError) throw secondError
  expect(second.rebooked_from).toBe(first.id)
  expect(second.court_id).toBe(first.court_id)
  expect(rangeMs(second.during).start).toBe(range.start + 7 * 86_400_000)
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
