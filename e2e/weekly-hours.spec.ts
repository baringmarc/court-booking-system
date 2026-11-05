// T17.15: the Weekly Hours & Rates editor. Runs in its own E2E venue (deleted afterwards) so the demo venue's schedule is
// never touched. Desktop and 360px.
import { expect, test, type Page } from '@playwright/test'
import { addVenueStaff, createPlayer, createVenue, deleteVenue, serviceClient, submitAdminLogin } from './support/helpers.ts'

type E2EVenue = Awaited<ReturnType<typeof createVenue>>
let venue: E2EVenue | undefined
let player: Awaited<ReturnType<typeof createPlayer>>

test.beforeEach(async () => {
  venue = await createVenue('weekly-hours')
  player = await createPlayer('weekly-hours')
  await addVenueStaff(venue.id, player.id)
})

test.afterEach(async () => {
  if (venue) await deleteVenue(venue.id)
  venue = undefined
})

async function openEditor(page: Page) {
  await page.goto(`${venue!.url}/admin/schedule`)
  await submitAdminLogin(page, player.email, player.password)
  await expect(page.getByRole('heading', { name: 'Weekly Hours & Rates' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Temporary Closures' })).toBeVisible()
}

/** No sideways page scroll (a string, because the e2e tsconfig has no DOM types). */
async function overflow(page: Page) {
  return page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
}

test('a custom court with split hours persists after reload while venue hours stay unchanged', async ({ page }) => {
  await openEditor(page)
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await page.getByRole('combobox', { name: 'Schedule for' }).selectOption({ label: venue!.court })
  await page.getByRole('combobox', { name: 'Court hours' }).selectOption({ label: 'Custom hours' })
  const monday = page.getByRole('group', { name: 'Monday' })
  await monday.getByLabel('Monday period 1 closes').selectOption({ label: '12 PM' })
  await monday.getByRole('button', { name: 'Add Monday period' }).click()
  await monday.getByLabel('Monday period 2 opens').selectOption({ label: '2 PM' })
  await monday.getByLabel('Monday period 2 closes').selectOption({ label: '10 PM' })
  await expect(monday.getByText('Closed 12 PM to 2 PM')).toBeVisible()
  await expect(page.getByText('You have unsaved changes.')).toBeVisible()
  await page.getByRole('button', { name: 'Save schedule' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Weekly Hours & Rates' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Schedule for' }).selectOption({ label: venue!.court })
  await expect(page.getByRole('combobox', { name: 'Court hours' })).toHaveValue(/custom/)
  const again = page.getByRole('group', { name: 'Monday' })
  await expect(again.getByLabel('Monday period 1 closes')).toHaveValue('12')
  await expect(again.getByLabel('Monday period 2 opens')).toHaveValue('14')
  await expect(again.getByText('Closed 12 PM to 2 PM')).toBeVisible()

  // The venue's own hours are untouched (6 AM to 10 PM every day).
  await page.getByRole('combobox', { name: 'Schedule for' }).selectOption({ label: 'Venue defaults' })
  const venueMonday = page.getByRole('group', { name: 'Monday' })
  await expect(venueMonday.getByLabel('Monday period 1 opens')).toHaveValue('6')
  await expect(venueMonday.getByLabel('Monday period 1 closes')).toHaveValue('22')
  await expect(venueMonday.getByLabel('Monday period 2 opens')).toHaveCount(0)

  const { data, error } = await serviceClient().from('venue_open_periods').select('day_of_week').eq('venue_id', venue!.id)
  if (error) throw error
  expect(data).toHaveLength(7)
})

test('a court that inherits venue hours follows a venue change', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('group', { name: 'Tuesday' }).getByLabel('Tuesday period 1 opens').selectOption({ label: '8 AM' })
  await page.getByRole('button', { name: 'Save schedule' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('combobox', { name: 'Schedule for' }).selectOption({ label: venue!.court })
  await expect(page.getByRole('combobox', { name: 'Court hours' })).toHaveValue(/inherit/)
  await expect(page.getByRole('group', { name: 'Tuesday' }).getByText(/8 AM.*10 PM/)).toBeVisible()
})

test('a stale revision shows the reload message and keeps the draft', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('group', { name: 'Monday' }).getByLabel('Monday period 1 closes').selectOption({ label: '8 PM' })
  // Someone else saves first: bump the revision directly.
  const service = serviceClient()
  const { data: state, error } = await service.from('venue_schedule_state').select('schedule_revision').eq('venue_id', venue!.id).single()
  if (error) throw error
  const { error: bumpError } = await service.from('venue_schedule_state').update({ schedule_revision: state.schedule_revision + 1 }).eq('venue_id', venue!.id)
  if (bumpError) throw bumpError
  await page.getByRole('button', { name: 'Save schedule' }).click()
  await expect(page.getByRole('alert').filter({ hasText: /reload/i })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Monday' }).getByLabel('Monday period 1 closes')).toHaveValue('20')
  await expect(page.getByText('You have unsaved changes.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reload latest' })).toBeVisible()
})
