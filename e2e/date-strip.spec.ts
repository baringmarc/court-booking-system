// /book's date strip (T11.4a): a guest picks a day from the strip, steps with the arrows, and jumps far ahead
// through the calendar; the URL follows and the strip slides to show the chosen day. Reads the venue's own closed
// days and booking window, so it holds on a local stack with edited hours.
import { expect, test } from '@playwright/test'
import { pickDate, serviceClient, venueDate } from './support/helpers.ts'

const dow = (date: string) => new Date(`${date}T12:00Z`).getUTCDay()

test('a guest picks days from the strip, steps with the arrows and jumps to a date', async ({ page }) => {
  const service = serviceClient()
  const { data: settings } = await service.from('venue_settings').select('booking_window_days').single().throwOnError()
  const { data: hours } = await service.from('operating_hours').select('day_of_week, is_closed').throwOnError()
  const closed = new Set(hours!.filter((h) => h.is_closed).map((h) => h.day_of_week))
  const window = settings!.booking_window_days
  test.skip(window < 12, 'needs a booking window of at least 12 days to jump past the strip')
  const open = (days: number) => !closed.has(dow(venueDate(days)))
  const firstOpen = (from: number) => { let d = from; while (!open(d)) d++; return d }

  await page.goto('/book')
  const strip = page.getByRole('group', { name: 'Date' })
  await expect(strip.getByRole('button', { name: /, today(, closed)?$/ })).toHaveAttribute('aria-pressed', 'true')
  const tiles = strip.locator('.date-tile')
  await expect(tiles).toHaveCount(10)

  // A day from the strip.
  const pick = firstOpen(1)
  await tiles.nth(pick).click()
  await expect(page).toHaveURL(new RegExp(`date=${venueDate(pick)}`))
  await expect(tiles.nth(pick)).toHaveAttribute('aria-pressed', 'true')

  // The arrows step a day; past the last tile, the strip slides along.
  await page.goto(`/book?date=${venueDate(9)}`)
  await expect(tiles.nth(9)).toHaveAttribute('aria-pressed', 'true')
  await strip.getByRole('button', { name: 'Next day' }).click()
  await expect(page).toHaveURL(new RegExp(`date=${venueDate(10)}`))
  await expect(tiles.nth(9)).toHaveAttribute('aria-pressed', 'true') // the strip moved one day
  await strip.getByRole('button', { name: 'Previous day' }).click()
  await expect(page).toHaveURL(new RegExp(`date=${venueDate(9)}`))

  // Jump to date: an open day beyond the strip.
  const far = firstOpen(11)
  test.skip(far > window, 'no open day inside the booking window beyond the strip')
  await page.goto('/book')
  await pickDate(page, page, 'Date', venueDate(far))
  await expect(page).toHaveURL(new RegExp(`date=${venueDate(far)}`))
  await expect(tiles.nth(9)).toHaveAttribute('aria-pressed', 'true')

  // The strip scrolls inside itself on a phone; the page never scrolls sideways.
  const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  expect(overflow, '/book scrolls sideways').toBeLessThanOrEqual(0)
})
