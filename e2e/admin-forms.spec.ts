// Even form rows (T11.5): settings fields wrap into columns that divide them evenly (four fields: 4, 2 or 1 per row,
// never 3 + 1), at phone, tablet and desktop widths. Measured from where the fields actually land.
import { expect, test, type Page } from '@playwright/test'
import { createAdmin, logInAdmin } from './support/helpers.ts'

/** The bits of an element this check reads (the e2e tsconfig has no DOM types). */
type Box = { children: ArrayLike<{ getBoundingClientRect(): { top: number } }> }

/** Fields per row in the grid that holds `label`, from their top edges. */
async function rowCounts(page: Page, label: string) {
  const grid = page.getByLabel(label).locator('xpath=ancestor::div[contains(@class, "form-grid")][1]')
  return grid.evaluate((el: Box) => {
    const rows = new Map<number, number>()
    for (const c of Array.from(el.children)) {
      const top = Math.round(c.getBoundingClientRect().top)
      rows.set(top, (rows.get(top) ?? 0) + 1)
    }
    return [...rows.values()]
  })
}

test('the booking rules fields wrap into even rows at every width', async ({ page }) => {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/settings')
  await expect(page.getByRole('heading', { name: 'Booking rules' })).toBeVisible()

  for (const [width, expected] of [[360, [1, 1, 1, 1]], [820, [2, 2]], [1280, [4]]] as const) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => rowCounts(page, 'Booking window (days ahead)'), `${width}px`).toEqual(expected)
  }
})

test('the social links fields (seven) never leave one alone on a row', async ({ page }) => {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/settings')
  const facebook = page.getByRole('form', { name: 'Social links' }).getByLabel('Facebook')
  await expect(facebook).toBeVisible()

  for (const [width, expected] of [[360, [1, 1, 1, 1, 1, 1, 1]], [820, [1, 1, 1, 1, 1, 1, 1]], [1280, [4, 3]]] as const) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => rowCounts(page, 'Facebook'), `${width}px`).toEqual(expected)
  }
})
