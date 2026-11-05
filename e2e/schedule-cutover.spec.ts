// T17.17: the cutover rehearsal on two venues. Venue A is activated (schedule_v2_active) with the service client; venue B
// stays on the legacy path and must be unaffected. Old-client writes to A's legacy hours and rates are refused, the
// Weekly Hours & Rates editor copies, reverts and warns, and the court edit page links to the editor instead of showing a
// weekly rate editor. Desktop and 360px, axe in both themes. All data is E2E-tagged; cleanup runs bookings first (CLAUDE.md L3).
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page } from '@playwright/test'
import { addVenueStaff, axeBothSchemes, createPlayer, createVenue, deleteVenue, serviceClient, submitAdminLogin, venueDate } from './support/helpers.ts'
import { localSupabase } from './support/local.ts'

type E2EVenue = Awaited<ReturnType<typeof createVenue>>
let active: E2EVenue | undefined
let legacy: E2EVenue | undefined
let player: Awaited<ReturnType<typeof createPlayer>>
let bookingId: string | undefined

const MESSAGE = 'Schedule is managed in Weekly Hours & Rates.'

function week(open: string, close: string) {
  return Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, open_time: open, close_time: close, is_closed: false }))
}

/** The next venue-local Monday at least three days away, as YYYY-MM-DD. */
function nextMonday() {
  for (let n = 3; n < 11; n++) {
    const date = venueDate(n)
    const [y, m, d] = date.split('-').map(Number)
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1) return date
  }
  throw new Error('no Monday found')
}

test.beforeEach(async () => {
  active = await createVenue('cutover-on')
  legacy = await createVenue('cutover-off')
  player = await createPlayer('cutover')
  await addVenueStaff(active.id, player.id)
  await addVenueStaff(legacy.id, player.id)
  const service = serviceClient()
  const { error } = await service.from('venue_schedule_state').update({ schedule_v2_active: true }).eq('venue_id', active.id)
  if (error) throw error
  const { data: court } = await service.from('courts').select('id').eq('venue_id', active.id).single().throwOnError()
  const day = nextMonday()
  const reference = `CB-CUT${String(Date.now() % 1000).padStart(3, '0').replace(/[01]/g, '2')}`
  const { data: booking } = await service.from('bookings').insert({
    reference_code: reference, court_id: court!.id, guest_name: 'E2E Cutover guest', source: 'walk_in', status: 'confirmed',
    total_amount: 700, during: `[${day}T18:00:00+08:00,${day}T19:00:00+08:00)`,
  }).select('id').single().throwOnError()
  bookingId = booking!.id
})

test.afterEach(async () => {
  const service = serviceClient()
  for (const venue of [active, legacy]) {
    if (!venue) continue
    await service.from('bookings').delete().eq('venue_id', venue.id).throwOnError()
    const { count } = await service.from('bookings').select('id', { count: 'exact', head: true }).eq('venue_id', venue.id)
    expect(count).toBe(0)
    await deleteVenue(venue.id)
  }
  active = undefined
  legacy = undefined
  bookingId = undefined
})

async function overflow(page: Page) {
  return page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
}

test('old clients are refused on the active venue while the legacy venue keeps working', async () => {
  const { url, publishableKey } = localSupabase()
  const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: loginError } = await client.auth.signInWithPassword({ email: player.email, password: player.password })
  if (loginError) throw loginError

  const refused = await client.rpc('set_operating_hours', { p_hours: week('07:00', '21:00'), p_venue_id: active!.id })
  expect(refused.error?.code).toBe('P0001')
  expect(refused.error?.message).toBe(MESSAGE)
  expect(refused.error?.hint).toBe('schedule_v2_managed')

  const tableWrite = await client.from('operating_hours').update({ close_time: '20:00' }).eq('venue_id', active!.id).eq('day_of_week', 2)
  expect(tableWrite.error?.message).toBe(MESSAGE)
  const { data: court } = await serviceClient().from('courts').select('id').eq('venue_id', active!.id).single().throwOnError()
  const rateWrite = await client.from('court_rates').insert({ venue_id: active!.id, court_id: court!.id, day_of_week: 2, start_hour: 9, price: 1 })
  expect(rateWrite.error?.message).toBe(MESSAGE)

  const { data: stillHours } = await serviceClient().from('operating_hours').select('open_time, close_time').eq('venue_id', active!.id)
  expect(stillHours).toHaveLength(7)
  expect(stillHours!.every((h) => h.open_time.startsWith('06:00') && h.close_time.startsWith('22:00'))).toBe(true)

  // The other venue is not blocked by the first one's activation.
  const allowed = await client.rpc('set_operating_hours', { p_hours: week('07:00', '21:00'), p_venue_id: legacy!.id })
  expect(allowed.error).toBeNull()
  const { data: changed } = await serviceClient().from('operating_hours').select('open_time').eq('venue_id', legacy!.id).eq('day_of_week', 3).single()
  expect(changed!.open_time.startsWith('07:00')).toBe(true)
})

test('the active venue copies, reverts and warns in Weekly Hours & Rates; the court page links there', async ({ page }) => {
  await page.goto(`${active!.url}/admin/schedule`)
  await submitAdminLogin(page, player.email, player.password)
  await expect(page.getByRole('heading', { name: 'Weekly Hours & Rates' })).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  const monday = page.getByRole('group', { name: 'Monday' })
  await monday.getByLabel('Monday period 1 closes').selectOption({ label: '12 PM' })
  await page.getByRole('button', { name: 'Copy Monday hours' }).click()
  await page.getByRole('checkbox', { name: 'Tuesday' }).check()
  await page.getByRole('button', { name: 'Apply copy' }).click()
  await expect(page.getByRole('group', { name: 'Tuesday' }).getByLabel('Tuesday period 1 closes')).toHaveValue('12')

  // The Monday 6 PM booking falls outside the new hours.
  const region = page.getByRole('region', { name: 'Reservations outside the new hours' })
  await expect(region).toBeVisible()
  await expect(region.getByText(/1 booking/)).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  expect(await axeBothSchemes(page)).toEqual([])

  await page.getByRole('button', { name: 'Revert unsaved changes' }).click()
  await page.getByRole('dialog', { name: 'Revert unsaved changes' }).getByRole('button', { name: 'Revert' }).click()
  await expect(page.getByRole('group', { name: 'Monday' }).getByLabel('Monday period 1 closes')).toHaveValue('22')
  await expect(page.getByRole('group', { name: 'Tuesday' }).getByLabel('Tuesday period 1 closes')).toHaveValue('22')
  await expect(page.getByRole('region', { name: 'Reservations outside the new hours' })).toHaveCount(0)

  // Nothing was saved, and the booking is untouched.
  const { data: periods } = await serviceClient().from('venue_open_periods').select('end_minute').eq('venue_id', active!.id)
  expect(periods).toHaveLength(7)
  expect(periods!.every((p) => p.end_minute === 1320)).toBe(true)
  const { data: kept } = await serviceClient().from('bookings').select('status').eq('id', bookingId!).single()
  expect(kept!.status).toBe('confirmed')

  // The court page no longer has a weekly rate editor, only a link to the schedule editor.
  const { data: court } = await serviceClient().from('courts').select('id').eq('venue_id', active!.id).single().throwOnError()
  await page.goto(`${active!.url}/admin/courts/${court!.id}`)
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Rates' })).toHaveCount(0)
  const link = page.getByRole('link', { name: /weekly hours/i })
  await expect(link).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  expect(await axeBothSchemes(page)).toEqual([])
  await link.click()
  await expect(page).toHaveURL(/\/admin\/schedule$/)
  await expect(page.getByRole('heading', { name: 'Weekly Hours & Rates' })).toBeVisible()
})
