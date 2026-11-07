// T17.15: the Weekly Hours & Rates editor. Runs in its own E2E venue (deleted afterwards) so the demo venue's schedule is
// never touched. Desktop and 360px.
import { expect, test, type Page } from '@playwright/test'
import { addVenueStaff, axeBothSchemes, createPlayer, createVenue, deleteVenue, serviceClient, submitAdminLogin } from './support/helpers.ts'

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
  await expect(page.getByRole('switch', { name: 'Monday open' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Schedule sections' })).toBeVisible()
}

/** Review & save, then Save changes in the dialog (T17.31). */
async function reviewAndSave(page: Page) {
  await page.getByRole('button', { name: 'Review & save' }).click()
  await page.getByRole('dialog', { name: 'Review changes' }).getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('region', { name: 'Unsaved changes' })).toHaveCount(0)
}

/** No sideways page scroll (a string, because the e2e tsconfig has no DOM types). */
async function overflow(page: Page) {
  return page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
}

test('a court with its own split hours persists after reload while venue hours stay unchanged', async ({ page }) => {
  await openEditor(page)
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await page.getByLabel('Choose a court').selectOption({ label: venue!.court })
  await page.getByRole('button', { name: 'Give this court different hours' }).click()
  await expect(page.getByText(`Editing ${venue!.court} only`)).toBeVisible()
  const monday = page.getByRole('group', { name: 'Monday' })
  await monday.getByRole('button', { name: /Add a break/ }).click()
  await expect(monday.getByText('Break 12 PM – 2 PM')).toBeVisible()
  // A second break on the same day.
  await monday.getByRole('button', { name: /Add a break/ }).click()
  await expect(monday.getByText(/^Break \d/)).toHaveCount(2)
  await monday.getByRole('button', { name: /Remove.*break/ }).last().click()
  await expect(monday.getByText('Break 12 PM – 2 PM')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await reviewAndSave(page)
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  await page.reload()
  await expect(page.getByRole('switch', { name: 'Monday open' })).toBeVisible()
  const list = page.getByRole('region', { name: 'Courts with different hours' })
  const item = list.getByRole('listitem').filter({ hasText: venue!.court })
  await expect(item).toBeVisible()
  await item.getByRole('button', { name: /^Edit hours/ }).click()
  const again = page.getByRole('group', { name: 'Monday' })
  await expect(again.getByLabel('Monday opens')).toHaveValue('6')
  await expect(again.getByLabel('Monday closes')).toHaveValue('22')
  await expect(again.getByText('Break 12 PM – 2 PM')).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  // The venue's own hours are untouched (6 AM to 10 PM every day, no break).
  await page.getByRole('button', { name: 'Back to all courts' }).click()
  const venueMonday = page.getByRole('group', { name: 'Monday' })
  await expect(venueMonday.getByLabel('Monday opens')).toHaveValue('6')
  await expect(venueMonday.getByLabel('Monday closes')).toHaveValue('22')
  await expect(venueMonday.getByText(/^Break/)).toHaveCount(0)

  const { data, error } = await serviceClient().from('venue_open_periods').select('day_of_week').eq('venue_id', venue!.id)
  if (error) throw error
  expect(data).toHaveLength(7)
})

test('venue hours: a closed day, a break and an after-midnight close save and come back; the week chart follows', async ({ page }) => {
  await openEditor(page)
  const chart = page.getByRole('region', { name: 'Week at a glance' })
  await expect(chart.getByText('Monday: open 6 AM to 10 PM')).toBeVisible()
  await page.getByRole('switch', { name: 'Sunday open' }).click()
  await page.getByRole('group', { name: 'Tuesday' }).getByRole('button', { name: /Add a break/ }).click()
  await page.getByLabel('Friday closes').selectOption({ label: '2 AM (next day)' })
  await expect(chart.getByText('Sunday: closed')).toBeVisible()
  await expect(chart.getByText('Tuesday: open 6 AM to 12 PM and 2 PM to 10 PM')).toBeVisible()
  await expect(chart.getByText('Friday: open 6 AM to 2 AM (next day)')).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await reviewAndSave(page)

  await page.reload()
  await expect(page.getByRole('switch', { name: 'Sunday open' })).not.toBeChecked()
  await expect(page.getByRole('group', { name: 'Tuesday' }).getByText('Break 12 PM – 2 PM')).toBeVisible()
  await expect(page.getByLabel('Friday closes')).toHaveValue('26')
  // Nothing is saved for Sunday any more, so turning it on gives the default 6 AM – 10 PM.
  await page.getByRole('switch', { name: 'Sunday open' }).click()
  await expect(page.getByLabel('Sunday opens')).toHaveValue('6')
  await expect(page.getByLabel('Sunday closes')).toHaveValue('22')

  const { data, error } = await serviceClient().from('venue_open_periods').select('day_of_week, start_minute, end_minute').eq('venue_id', venue!.id).eq('day_of_week', 2).order('start_minute')
  if (error) throw error
  expect(data!.map((p) => [p.start_minute, p.end_minute])).toEqual([[360, 720], [840, 1320]])
})

test('an overlap into the next day is explained in the row and blocks Review & save, Sunday into Monday included', async ({ page }) => {
  await openEditor(page)
  await page.getByLabel('Monday opens').selectOption({ label: '1 AM' })
  await page.getByLabel('Sunday closes').selectOption({ label: '3 AM (next day)' })
  await expect(page.getByRole('group', { name: 'Sunday' }).getByRole('alert')).toContainText(/overlap/i)
  await expect(page.getByRole('group', { name: 'Monday' }).getByRole('alert')).toContainText(/overlap/i)
  await expect(page.getByRole('button', { name: 'Review & save' })).toBeDisabled()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  expect(await axeBothSchemes(page)).toEqual([])
  await page.getByLabel('Sunday closes').selectOption({ label: 'Midnight' })
  await expect(page.getByRole('button', { name: 'Review & save' })).toBeEnabled()
})

test('Opening hours is axe clean with a court being edited, and the court can go back to the opening hours', async ({ page }) => {
  await openEditor(page)
  expect(await axeBothSchemes(page), 'venue table').toEqual([])
  await page.getByLabel('Choose a court').selectOption({ label: venue!.court })
  await page.getByRole('button', { name: 'Give this court different hours' }).click()
  await expect(page.getByText(`Editing ${venue!.court} only`)).toBeVisible()
  expect(await axeBothSchemes(page), 'court edit view').toEqual([])
  await page.getByLabel('Monday closes').selectOption({ label: '8 PM' })
  await reviewAndSave(page)
  const back = page.getByRole('button', { name: 'Back to all courts' })
  if (await back.isVisible()) await back.click()
  const item = page.getByRole('region', { name: 'Courts with different hours' }).getByRole('listitem').filter({ hasText: venue!.court })
  await expect(item.getByText(/Monday: 6 AM – 8 PM/)).toBeVisible()
  expect(await axeBothSchemes(page), 'with the list').toEqual([])
  await item.getByRole('button', { name: /^Use opening hours/ }).click()
  await page.getByRole('dialog', { name: `Use opening hours for ${venue!.court}` }).getByRole('button', { name: 'Use opening hours' }).click()
  await reviewAndSave(page)
  await expect(page.getByRole('region', { name: 'Courts with different hours' }).getByRole('listitem').filter({ hasText: venue!.court })).toHaveCount(0)
  const { data, error } = await serviceClient().from('court_schedule_modes').select('schedule_mode').eq('venue_id', venue!.id)
  if (error) throw error
  expect(data!.every((m) => m.schedule_mode === 'inherit')).toBe(true)
})

test('a court that inherits venue hours follows a venue change', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('group', { name: 'Tuesday' }).getByLabel('Tuesday opens').selectOption({ label: '8 AM' })
  await reviewAndSave(page)
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Monday open' })).toBeVisible()
  // The court is not listed under "Courts with different hours": it still follows the opening hours.
  await expect(page.getByRole('region', { name: 'Courts with different hours' }).getByRole('listitem').filter({ hasText: venue!.court })).toHaveCount(0)
  await expect(page.getByLabel('Choose a court').locator('option', { hasText: venue!.court })).toHaveCount(1)
  await expect(page.getByLabel('Tuesday opens')).toHaveValue('8')
})

test('a stale revision shows the reload message and keeps the draft', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('group', { name: 'Monday' }).getByLabel('Monday closes').selectOption({ label: '8 PM' })
  // Someone else saves first: bump the revision directly.
  const service = serviceClient()
  const { data: state, error } = await service.from('venue_schedule_state').select('schedule_revision').eq('venue_id', venue!.id).single()
  if (error) throw error
  const { error: bumpError } = await service.from('venue_schedule_state').update({ schedule_revision: state.schedule_revision + 1 }).eq('venue_id', venue!.id)
  if (bumpError) throw bumpError
  await page.getByRole('button', { name: 'Review & save' }).click()
  await page.getByRole('dialog', { name: 'Review changes' }).getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('alert').filter({ hasText: /reload/i })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Monday' }).getByLabel('Monday closes')).toHaveValue('20')
  await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review & save' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Reload latest' })).toBeVisible()
})
