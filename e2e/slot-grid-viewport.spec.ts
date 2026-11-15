// T27.6: on a phone the slot grid (header and first slot row) is on screen without scrolling,
// and the sport switcher and date tiles are at least 44px tall. Creates no data.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'

async function openBook(page: Page) {
  await page.goto('/book')
  await expect(page.locator('.slot-grid').first()).toBeVisible()
  await expect(page.locator('.slot-grid button.slot').first()).toBeVisible()
}

async function checks(page: Page) {
  const height = page.viewportSize()!.height

  const head = await page.locator('.slot-grid thead').first().boundingBox()
  expect(head, 'grid header has a box').not.toBeNull()
  expect(head!.y).toBeGreaterThanOrEqual(0)
  expect(head!.y + head!.height, 'grid header is above the fold').toBeLessThanOrEqual(height)

  const slot = await page.locator('.slot-grid button.slot').first().boundingBox()
  expect(slot, 'first slot has a box').not.toBeNull()
  expect(slot!.y + slot!.height, 'first slot is above the fold').toBeLessThanOrEqual(height)

  const sport = page.getByRole('group', { name: 'Sport' }).getByRole('button')
  const sportCount = await sport.count()
  if (sportCount > 0) {
    for (let i = 0; i < sportCount; i++) {
      const box = await sport.nth(i).boundingBox()
      expect(box!.height, `sport button ${i} height`).toBeGreaterThanOrEqual(44)
    }
  }

  const tiles = page.locator('.date-tile')
  const n = await tiles.count()
  expect(n).toBeGreaterThan(0)
  for (let i = 0; i < n; i++) {
    const box = await tiles.nth(i).boundingBox()
    expect(box!.height, `date tile ${i} height`).toBeGreaterThanOrEqual(44)
  }

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).join(', ')}`)
  expect(bad, '/book').toEqual([])
}

test.describe('slot grid in the viewport (project viewport)', () => {
  test('the grid header and the first slot row are visible without scrolling', async ({ page }) => {
    await openBook(page)
    await checks(page)
  })
})

test.describe('slot grid in a 390x844 viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('the grid header and the first slot row are visible without scrolling', async ({ page }) => {
    await openBook(page)
    await checks(page)
  })
})

// H14: keep last.
guardLeaks()
