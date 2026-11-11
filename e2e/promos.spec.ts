// T19.2: the Promos tab on /admin/schedule. Runs in its own E2E venue (deleted afterwards, promos first) so the demo
// venue is never touched. Desktop and 360px. Helpers relied on, all from e2e/support/helpers.ts: createVenue (venue with
// one court, `venue.court`, and `venue.url`), createPlayer + addVenueStaff (a staff login for that venue),
// submitAdminLogin, axeBothSchemes, serviceClient, deleteVenue.
import { expect, test, type Page } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { addVenueStaff, axeBothSchemes, createPlayer, createVenue, deleteVenue, pickDate, serviceClient, submitAdminLogin, venueDate } from './support/helpers.ts'

type E2EVenue = Awaited<ReturnType<typeof createVenue>>
let venue: E2EVenue | undefined
let player: Awaited<ReturnType<typeof createPlayer>>

const LABEL = 'E2E weekend promo'

test.beforeEach(async () => {
  venue = await createVenue('promos')
  player = await createPlayer('promos')
  await addVenueStaff(venue.id, player.id)
})

test.afterEach(async () => {
  if (!venue) return
  // Foreign-key order: court links, then promos, then the venue (deleteVenue removes its courts first).
  const service = serviceClient()
  for (const table of ['court_promo_courts', 'court_promos'] as const) {
    const { error } = await service.from(table).delete().eq('venue_id', venue.id)
    if (error) throw error
  }
  await deleteVenue(venue.id)
  venue = undefined
})

async function openPromos(page: Page) {
  await page.goto(`${venue!.url}/admin/schedule?tab=promos`)
  await submitAdminLogin(page, player.email, player.password)
  await expect(page.getByRole('tablist', { name: 'Schedule sections' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Promos' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { level: 2, name: 'Promos' })).toBeVisible()
}

/** No sideways page scroll (a string, because the e2e tsconfig has no DOM types). */
async function overflow(page: Page) {
  return page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
}

/** Fills the open Promo form: Today to a week on (so the range always holds a Saturday and a Sunday), Saturday and Sunday, the venue's court, 6 PM to 9 PM. */
async function fillForm(page: Page, name: string, price: string) {
  const form = page.getByRole('form', { name: 'Promo' })
  await expect(form).toBeVisible()
  await form.getByLabel('Promo name').fill(name)
  await form.getByRole('group', { name: 'Starts on' }).getByRole('button', { name: 'Today' }).click()
  await pickDate(page, form, 'Ends on', venueDate(7))
  await form.getByRole('group', { name: 'Days' }).getByRole('checkbox', { name: 'Saturday' }).check()
  await form.getByRole('group', { name: 'Days' }).getByRole('checkbox', { name: 'Sunday' }).check()
  await form.getByRole('group', { name: 'Courts' }).getByRole('checkbox', { name: venue!.court }).check()
  await form.getByLabel('From', { exact: true }).selectOption({ label: '6 PM' })
  await form.getByLabel('Until', { exact: true }).selectOption({ label: '9 PM' })
  await form.getByLabel('Price per hour').fill(price)
}

test('add, see, edit, reject an overlap and delete a promo; it survives a reload', async ({ page }) => {
  await openPromos(page)
  await expect(page.getByText('No promos yet.')).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  // Add.
  await page.getByRole('button', { name: 'Add promo' }).click()
  await fillForm(page, LABEL, '500')
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  expect(await axeBothSchemes(page), 'add form').toEqual([])
  await page.getByRole('button', { name: 'Save promo' }).click()
  await expect(page.getByRole('form', { name: 'Promo' })).toHaveCount(0)

  const item = page.getByRole('listitem').filter({ hasText: LABEL })
  await expect(item).toBeVisible()
  await expect(item).toContainText(venue!.court)
  await expect(item).toContainText('₱500/hr')
  await expect(item).toContainText('6 PM – 9 PM')
  await expect(item.getByText('Active', { exact: true })).toBeVisible()
  await expect(page.getByText('No promos yet.')).toHaveCount(0)
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  expect(await axeBothSchemes(page), 'list').toEqual([])

  // It is stored for this venue, once.
  const { data, error } = await serviceClient().from('court_promos').select('label, price, days_of_week, start_hour, end_hour').eq('venue_id', venue!.id)
  if (error) throw error
  expect(data).toHaveLength(1)
  expect(data![0]).toMatchObject({ label: LABEL, price: 500, start_hour: 18, end_hour: 21 })
  expect([...data![0].days_of_week].sort()).toEqual([0, 6])

  // Edit the price.
  await item.getByRole('button', { name: `Edit promo: ${LABEL}` }).click()
  const edit = page.getByRole('form', { name: 'Promo' })
  await expect(edit.getByLabel('Promo name')).toHaveValue(LABEL)
  await expect(edit.getByLabel('Price per hour')).toHaveValue('500')
  await edit.getByLabel('Price per hour').fill('450')
  await edit.getByRole('button', { name: 'Save promo' }).click()
  await expect(page.getByRole('form', { name: 'Promo' })).toHaveCount(0)
  await expect(item).toContainText('₱450/hr')
  await expect(page.getByRole('listitem').filter({ hasText: LABEL })).toHaveCount(1)

  // A second promo on the same court, days and hours overlaps the first.
  await page.getByRole('button', { name: 'Add promo' }).click()
  await fillForm(page, 'E2E second promo', '400')
  await page.getByRole('button', { name: 'Save promo' }).click()
  await expect(page.getByRole('alert').filter({ hasText: `overlaps "${LABEL}"` })).toBeVisible()
  await expect(page.getByRole('form', { name: 'Promo' })).toBeVisible()
  await expect(page.getByLabel('Promo name')).toHaveValue('E2E second promo')
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  expect(await axeBothSchemes(page), 'overlap error').toEqual([])
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'E2E second promo' })).toHaveCount(0)

  // The edit persists after a reload.
  await page.reload()
  await expect(page.getByRole('heading', { level: 2, name: 'Promos' })).toBeVisible()
  const again = page.getByRole('listitem').filter({ hasText: LABEL })
  await expect(again).toContainText('₱450/hr')

  // Delete, with the confirmation.
  await again.getByRole('button', { name: `Delete promo: ${LABEL}` }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete this promo?' })
  await expect(dialog).toBeVisible()
  expect(await axeBothSchemes(page), 'delete dialog').toEqual([])
  await dialog.getByRole('button', { name: 'Keep promo' }).click()
  await expect(again).toBeVisible()
  await again.getByRole('button', { name: `Delete promo: ${LABEL}` }).click()
  await page.getByRole('dialog', { name: 'Delete this promo?' }).getByRole('button', { name: 'Delete promo' }).click()
  await expect(page.getByText('No promos yet.')).toBeVisible()

  await page.reload()
  await expect(page.getByText('No promos yet.')).toBeVisible()
  const { data: left, error: leftError } = await serviceClient().from('court_promos').select('id').eq('venue_id', venue!.id)
  if (leftError) throw leftError
  expect(left).toHaveLength(0)
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
