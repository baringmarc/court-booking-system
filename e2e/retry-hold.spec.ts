// T27.5: after a hold expires, the booking page's "Try this time again" opens checkout with the same court,
// start and hours. Runs at desktop and 360px (both Playwright projects).
// Data: the guest is tagged `E2E…` and the booking is deleted in afterEach (checked), global teardown is the backstop.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { E2E_PREFIX, pickFirstFreeSlot, serviceClient, venueDate } from './support/helpers.ts'

test.afterEach(async () => {
  const service = serviceClient()
  const { error } = await service.from('bookings').delete().like('guest_name', `${E2E_PREFIX}%`)
  if (error) throw error
  const left = await service.from('bookings').select('id', { count: 'exact', head: true }).like('guest_name', `${E2E_PREFIX}%`)
  expect(left.count, 'E2E bookings left behind').toBe(0)
})

test('an expired hold offers Try this time again, which reopens checkout for the same time', async ({ page }) => {
  await pickFirstFreeSlot(page, { date: venueDate(12), sport: 'pickleball', court: 'Pickleball 1' })
  await page.getByLabel('Name').fill(`${E2E_PREFIX} Retry Guest`)
  await page.getByLabel('Email').fill(`e2e-retry-${Date.now()}@example.com`)
  await page.getByRole('button', { name: 'Reserve and continue to payment' }).click()
  await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
  const reference = new URL(page.url()).pathname.split('/').pop()!

  // Expire the hold in the database, as the hold timer would.
  const service = serviceClient()
  const { data: row, error } = await service.from('bookings').select('court_id, during').eq('reference_code', reference).single()
  if (error) throw error
  const expired = await service.from('bookings').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('reference_code', reference)
  if (expired.error) throw expired.error

  await page.reload()
  await expect(page.getByText(/This hold expired before payment was received/)).toBeVisible()
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])

  await page.getByRole('link', { name: 'Try this time again' }).click()
  await expect(page).toHaveURL(/\/book\/checkout\?/)
  const params = new URL(page.url()).searchParams
  // `during` is a tstzrange; PostgREST returns it as a string like ["2030-01-07 09:00:00+00","2030-01-07 10:00:00+00")
  const [rangeStart = '', rangeEnd = ''] = String(row.during).match(/\d{4}-\d{2}-\d{2} [\d:.]+(?:[+-]\d{2}(?::\d{2})?)?/g) ?? []
  const toMs = (v: string) => Date.parse(v.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'))
  const startMs = toMs(rangeStart)
  const hours = Math.round((toMs(rangeEnd) - startMs) / 3_600_000)
  expect(params.get('court')).toBe(row.court_id)
  expect(new Date(params.get('start') ?? '').toISOString()).toBe(new Date(startMs).toISOString())
  expect(params.get('slots')).toBe(String(hours))
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reserve and continue to payment' })).toBeVisible()
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
