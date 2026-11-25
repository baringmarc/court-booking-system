// T33.1: today's slot grid opens scrolled so the current hour sits under the sticky header; other days open at the top.
// The browser clock is fixed to 20:15 or 12:15 Manila today; the server's "now" is the real time (L4), so only row positions
// are asserted, never which slots are past or enabled. Creates no data.
import { expect, test, type Page } from '@playwright/test'
import { axeBothSchemes, venueDate } from './support/helpers.ts'
import { guardLeaks } from './support/leaks.ts'

/** hh:15 Manila (UTC+8) on the venue's today, as an instant. */
function quarterPast(hour: number) {
  return new Date(`${venueDate(0)}T${String(hour).padStart(2, '0')}:15:00+08:00`)
}

async function openDay(page: Page, date: string, hour = 20) {
  await page.clock.setFixedTime(quarterPast(hour))
  await page.goto(`/book?date=${date}`)
  await expect(page.getByRole('region', { name: 'Court times' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Court times' }).getByRole('rowheader').first()).toBeVisible()
}

// "Just under the sticky header": the grid's border-spacing and the region's border add a few px (the same band the
// tomorrow test uses for the first row), and the header's own box is not the thead's.
const underHeader = (gap: number) => gap >= -1 && gap <= 8

const gridRegion = (page: Page) => page.getByRole('region', { name: 'Court times' })

test.describe('slot grid opens at the current hour', () => {
  // User's call 2026-11-24: the region can't scroll past its last row, so near closing the current row may sit lower
  // in the box (region scrolled to its end) instead of at the top.
  test('today at 8 PM: the row is under the header, or the region is scrolled to its end with the row in view', async ({ page }) => {
    await openDay(page, venueDate(0), 20)
    const region = gridRegion(page)
    const eight = region.getByRole('rowheader', { name: /^8 PM – 9 PM/ })
    test.skip((await eight.count()) === 0, 'today has no "8 PM – 9 PM" row on the demo venue')

    const scrollYBefore = await page.evaluate('window.scrollY') as number
    // Layout settles after the data renders.
    await expect.poll(async () => region.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

    const head = (await page.locator('.slot-grid thead th').first().boundingBox())!
    const headBottom = head.y + head.height
    await expect
      .poll(async () => {
        const row = (await eight.boundingBox())!
        const box = (await region.boundingBox())!
        const m = await region.evaluate((el) => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }))
        const atTop = underHeader(row.y - headBottom)
        const atEnd = Math.abs(m.top - m.max) <= 2 && row.y >= headBottom - 2 && row.y + row.height <= box.y + box.height + 2
        return atTop || atEnd ? 'ok' : `row ${row.y - headBottom}px below header, scrollTop ${m.top} of max ${m.max}`
      })
      .toBe('ok')

    // Derived: once the region has scrolled by at least one row height, the opening-hour row is out of view.
    const first = (await region.getByRole('rowheader').first().boundingBox())!
    const scrollTop = await region.evaluate((el) => el.scrollTop)
    if (scrollTop >= first.height + 1) {
      expect(first.y + first.height, 'the opening-hour row is scrolled out').toBeLessThanOrEqual(headBottom + 1)
    }

    expect(await page.evaluate('window.scrollY'), 'the page itself did not scroll').toBe(scrollYBefore)

    expect(await axeBothSchemes(page, '.slot-grid')).toEqual([])
  })

  test('today at 12 PM: the 12 PM row sits right under the header', async ({ page }) => {
    await openDay(page, venueDate(0), 12)
    const region = gridRegion(page)
    const noon = region.getByRole('rowheader', { name: /^12 PM – 1 PM/ })
    test.skip((await noon.count()) === 0, 'today has no "12 PM – 1 PM" row on the demo venue')

    const scrollYBefore = await page.evaluate('window.scrollY') as number
    await expect.poll(async () => region.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

    const head = (await page.locator('.slot-grid thead th').first().boundingBox())!
    const headBottom = head.y + head.height
    await expect.poll(async () => underHeader((await noon.boundingBox())!.y - headBottom)).toBe(true)

    const first = (await region.getByRole('rowheader').first().boundingBox())!
    expect(first.y + first.height, 'the opening-hour row is scrolled out').toBeLessThanOrEqual(headBottom + 1)
    expect(await page.evaluate('window.scrollY'), 'the page itself did not scroll').toBe(scrollYBefore)
  })

  test('tomorrow: the grid opens at the top', async ({ page }) => {
    await openDay(page, venueDate(1))
    const region = gridRegion(page)
    // Give any (wrong) scroll a moment to happen, then check it did not.
    await page.waitForTimeout(500)
    expect(await region.evaluate((el) => el.scrollTop)).toBe(0)

    const head = (await page.locator('.slot-grid thead th').first().boundingBox())!
    const first = (await region.getByRole('rowheader').first().boundingBox())!
    // Just under the header: borders and padding can add a few px.
    expect(first.y - (head.y + head.height)).toBeGreaterThanOrEqual(-1)
    expect(first.y - (head.y + head.height)).toBeLessThanOrEqual(8)
  })
})

// H14: keep last.
guardLeaks()
