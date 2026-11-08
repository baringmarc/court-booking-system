// Even form rows (T11.5): settings fields wrap into columns that divide them evenly (four fields: 4, 2 or 1 per row,
// never 3 + 1), at phone, tablet and desktop widths. Measured from where the fields actually land.
import { expect, test, type Page } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
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

test('the booking rules fields sit one per row at every width without stretched inputs', async ({ page }) => {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/settings/booking')
  await expect(page.getByRole('heading', { name: 'Booking rules', exact: true })).toBeVisible()
  const labels = ['Booking window', 'Payment hold', 'Cancellation cutoff', 'Proof rejections allowed']

  for (const width of [360, 820, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(async () => {
      const boxes = await Promise.all(labels.map((label) => page.getByLabel(label, { exact: true }).boundingBox()))
      const tops = boxes.map((box) => Math.round(box?.y ?? -1))
      return new Set(tops).size === 4 && tops.every((top, i) => i === 0 || top > tops[i - 1])
    }, `${width}px one per row`).toBe(true)
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  for (const label of labels) {
    const box = await page.getByLabel(label, { exact: true }).boundingBox()
    expect(box?.width ?? 9999, label).toBeLessThanOrEqual(160)
  }
  await page.setViewportSize({ width: 360, height: 900 })
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBeLessThanOrEqual(0)
})

test('the social links fields (seven) never leave one alone on a row', async ({ page }) => {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/settings/venue')
  const facebook = page.getByRole('form', { name: 'Social links' }).getByLabel('Facebook')
  await expect(facebook).toBeVisible()

  for (const [width, expected] of [[360, [1, 1, 1, 1, 1, 1, 1]], [820, [1, 1, 1, 1, 1, 1, 1]], [1280, [4, 3]]] as const) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => rowCounts(page, 'Facebook'), `${width}px`).toEqual(expected)
  }
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
