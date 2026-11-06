// T17.31: the Schedule page's tabs (Opening hours, Prices, Closures), the sticky save bar and the Review changes dialog.
// Runs in its own E2E venue (deleted afterwards) so the demo venue's schedule is never touched. Desktop and 360px.
import { expect, test, type Page } from '@playwright/test'
import { addVenueStaff, axeBothSchemes, createPlayer, createVenue, deleteVenue, submitAdminLogin } from './support/helpers.ts'

type E2EVenue = Awaited<ReturnType<typeof createVenue>>
let venue: E2EVenue | undefined
let player: Awaited<ReturnType<typeof createPlayer>>

test.beforeEach(async () => {
  venue = await createVenue('schedule-tabs')
  player = await createPlayer('schedule-tabs')
  await addVenueStaff(venue.id, player.id)
})

test.afterEach(async () => {
  if (venue) await deleteVenue(venue.id)
  venue = undefined
})

const HOURS_TAB = /^Opening hours/
const PRICES_TAB = /^Prices/
const CLOSURES_TAB = /^Closures/

async function openSchedule(page: Page) {
  await page.goto(`${venue!.url}/admin/schedule`)
  await submitAdminLogin(page, player.email, player.password)
  await expect(page.getByRole('tablist', { name: 'Schedule sections' })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Monday open' })).toBeVisible()
}

const bar = (page: Page) => page.getByRole('region', { name: 'Unsaved changes' })
const saturdayCloses = (page: Page) => page.getByRole('group', { name: 'Saturday' }).getByLabel('Saturday closes')

/** No sideways page scroll (a string, because the e2e tsconfig has no DOM types). */
async function overflow(page: Page) {
  return page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
}

/** Whether the focused element sits inside the open dialog. */
async function focusInDialog(page: Page) {
  return page.evaluate<boolean>("Boolean(document.activeElement && document.activeElement.closest('[role=\"dialog\"]'))")
}

test('edit hours, switch tabs with the draft kept, review in plain words, save and see it after a reload', async ({ page }) => {
  await openSchedule(page)
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await expect(bar(page)).toHaveCount(0)
  await saturdayCloses(page).selectOption({ label: '9 PM' })
  await expect(bar(page)).toBeVisible()
  await expect(bar(page)).toContainText('1 unsaved change')

  await page.getByRole('tab', { name: PRICES_TAB }).click()
  await expect(page).toHaveURL(/tab=prices/)
  await expect(page.getByRole('tab', { name: 'Opening hours, unsaved changes' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Prices for' })).toBeVisible()
  await expect(bar(page)).toBeVisible()

  // Back returns to the previous tab with the draft intact.
  await page.goBack()
  await expect(page.getByRole('tab', { name: HOURS_TAB })).toHaveAttribute('aria-selected', 'true')
  await expect(saturdayCloses(page)).toHaveValue('21')
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  await page.getByRole('button', { name: 'Review & save' }).click()
  const dialog = page.getByRole('dialog', { name: 'Review changes' })
  await expect(dialog.getByRole('listitem').filter({ hasText: 'Saturday: 6 AM – 10 PM → 6 AM – 9 PM' })).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(bar(page)).toHaveCount(0)

  await page.reload()
  await expect(saturdayCloses(page)).toHaveValue('21')
  await expect(page.getByRole('tab', { name: 'Opening hours' })).toBeVisible()
})

test('a price change is reviewed and saved from the Prices tab', async ({ page }) => {
  await openSchedule(page)
  await page.getByRole('tab', { name: PRICES_TAB }).click()
  await page.getByRole('combobox', { name: 'Prices for' }).selectOption({ label: venue!.court })
  await page.getByLabel('Rate day').selectOption({ label: 'Monday' })
  await page.getByLabel('Rate from').selectOption({ label: '6 PM' })
  await page.getByLabel('Rate to').selectOption({ label: '7 PM' })
  await page.getByLabel('Override price').fill('950')
  await page.getByRole('button', { name: 'Apply rate' }).click()
  await expect(page.getByRole('tab', { name: 'Prices, unsaved changes' })).toBeVisible()
  await page.getByRole('button', { name: 'Review & save' }).click()
  const dialog = page.getByRole('dialog', { name: 'Review changes' })
  await expect(dialog.getByRole('listitem').filter({ hasText: `${venue!.court}, Monday 6 PM – 7 PM: ₱950 (was ₱700)` })).toBeVisible()
  // A price-only change has no booking impact to check.
  await expect(dialog.getByRole('heading', { name: 'Bookings outside the new hours' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(bar(page)).toHaveCount(0)
  await page.reload()
  // The saved override is listed on the Prices tab for the court, as a run of hours (T17.33).
  await page.getByRole('tab', { name: PRICES_TAB }).click()
  const monday = page.getByRole('tabpanel', { name: PRICES_TAB }).getByRole('listitem').filter({ hasText: 'Monday' })
  await expect(monday).toContainText('6 PM – 7 PM')
  await expect(monday).toContainText('₱950')
})

test('Discard asks first: Keep editing keeps the draft, Discard restores the saved hours', async ({ page }) => {
  await openSchedule(page)
  await saturdayCloses(page).selectOption({ label: '9 PM' })
  const discard = bar(page).getByRole('button', { name: 'Discard' })
  await discard.click()
  const dialog = page.getByRole('dialog', { name: 'Discard changes' })
  await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Keep editing' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(saturdayCloses(page)).toHaveValue('21')
  await expect(discard).toBeFocused()

  await discard.click()
  await page.getByRole('dialog', { name: 'Discard changes' }).getByRole('button', { name: 'Discard' }).click()
  await expect(saturdayCloses(page)).toHaveValue('22')
  await expect(bar(page)).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Opening hours' })).toBeVisible()
})

test('the sticky save bar never covers the last control, on either tab', async ({ page }) => {
  await openSchedule(page)
  await saturdayCloses(page).selectOption({ label: '9 PM' })
  await expect(bar(page)).toBeVisible()

  async function expectClear(lastControl: ReturnType<Page['getByRole']>, where: string) {
    await lastControl.evaluate("(el) => el.scrollIntoView({ block: 'end' })")
    await expect(bar(page)).toBeVisible()
    const control = await lastControl.boundingBox()
    const strip = await bar(page).boundingBox()
    expect(control, `${where}: control box`).not.toBeNull()
    expect(strip, `${where}: bar box`).not.toBeNull()
    const overlaps = control!.y < strip!.y + strip!.height && strip!.y < control!.y + control!.height
    expect(overlaps, `${where}: the bar covers the last control`).toBe(false)
  }

  await expectClear(page.getByRole('button', { name: 'Copy to every day' }), 'Opening hours')
  await page.getByRole('tab', { name: PRICES_TAB }).click()
  await expectClear(page.getByRole('button', { name: 'Apply rate' }), 'Prices')
  expect(await overflow(page)).toBeLessThanOrEqual(0)
})

test('axe is clean in both color schemes on every tab, with the bar and the dialog open', async ({ page }) => {
  await openSchedule(page)
  expect(await axeBothSchemes(page), 'clean Opening hours').toEqual([])
  await saturdayCloses(page).selectOption({ label: '9 PM' })
  await expect(bar(page)).toBeVisible()
  expect(await axeBothSchemes(page), 'Opening hours with the bar').toEqual([])
  await page.getByRole('tab', { name: PRICES_TAB }).click()
  expect(await axeBothSchemes(page), 'Prices with the bar').toEqual([])
  await page.getByRole('tab', { name: CLOSURES_TAB }).click()
  expect(await axeBothSchemes(page), 'Closures with the bar').toEqual([])
  await page.getByRole('button', { name: 'Review & save' }).click()
  await expect(page.getByRole('dialog', { name: 'Review changes' })).toBeVisible()
  expect(await axeBothSchemes(page), 'Review changes').toEqual([])
  await page.keyboard.press('Escape')
  await bar(page).getByRole('button', { name: 'Discard' }).click()
  await expect(page.getByRole('dialog', { name: 'Discard changes' })).toBeVisible()
  expect(await axeBothSchemes(page), 'Discard changes').toEqual([])
})

test('keyboard only: arrow keys switch tabs, and focus returns after each dialog', async ({ page }) => {
  await openSchedule(page)
  const hoursTab = page.getByRole('tab', { name: HOURS_TAB })
  await hoursTab.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: PRICES_TAB })).toBeFocused()
  await expect(page.getByRole('tab', { name: PRICES_TAB })).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/tab=prices/)
  await page.keyboard.press('End')
  await expect(page.getByRole('tab', { name: CLOSURES_TAB })).toBeFocused()
  await expect(page).toHaveURL(/tab=closures/)
  await page.keyboard.press('ArrowRight')
  await expect(hoursTab).toBeFocused()
  await expect(hoursTab).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tab', { name: CLOSURES_TAB })).toBeFocused()
  await page.keyboard.press('Home')
  await expect(hoursTab).toBeFocused()

  // A change, then the two dialogs from the keyboard.
  await saturdayCloses(page).selectOption({ label: '9 PM' })
  const review = bar(page).getByRole('button', { name: 'Review & save' })
  await review.focus()
  await page.keyboard.press('Enter')
  const reviewDialog = page.getByRole('dialog', { name: 'Review changes' })
  await expect(reviewDialog).toBeVisible()
  expect(await focusInDialog(page)).toBe(true)
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    expect(await focusInDialog(page), `Tab ${i + 1} stays in the dialog`).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(reviewDialog).toHaveCount(0)
  await expect(review).toBeFocused()

  const discard = bar(page).getByRole('button', { name: 'Discard' })
  await discard.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Discard changes' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Discard changes' })).toHaveCount(0)
  await expect(discard).toBeFocused()
  await expect(saturdayCloses(page)).toHaveValue('21')
})
