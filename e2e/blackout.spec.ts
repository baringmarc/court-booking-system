// T10.3: an admin adds a blackout with the date and hour pickers; a guest picks that date in /book's calendar and
// sees the court closed then. The pickers are checked with axe, light and dark, with the calendar open.
import { AxeBuilder } from '@axe-core/playwright'
import { createHash, randomBytes } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { createAdmin, E2E_PREFIX, logInAdmin, pickDate, serviceClient, venueDate, setColorScheme } from './support/helpers.ts'

const date = venueDate(23)

/** Serious or critical WCAG A/AA violations, in light and dark mode (the a11y spec's rule). */
async function axeViolations(page: Page) {
  const found: string[] = []
  for (const colorScheme of ['light', 'dark'] as const) {
    await setColorScheme(page, colorScheme)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    found.push(...results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${colorScheme} ${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`))
  }
  await page.emulateMedia({ colorScheme: null })
  return found
}

/** No sideways page scroll (a string, because the e2e tsconfig has no DOM types). */
async function overflow(page: Page) {
  return page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
}

// A closure blocks real slots and a booking holds one: remove both even when the test fails (global teardown is the
// backstop). Closures are tagged through their reason, bookings through the guest name; the booking goes first (its
// payments cascade), and both deletions are checked.
test.afterEach(async () => {
  const service = serviceClient()
  const { error: bookingError } = await service.from('bookings').delete().like('guest_name', `${E2E_PREFIX}%`)
  if (bookingError) throw bookingError
  const { error } = await service.from('blackouts').delete().like('reason', `${E2E_PREFIX}%`)
  if (error) throw error
  const bookings = await service.from('bookings').select('id', { count: 'exact', head: true }).like('guest_name', `${E2E_PREFIX}%`)
  const closures = await service.from('blackouts').select('id', { count: 'exact', head: true }).like('reason', `${E2E_PREFIX}%`)
  expect(bookings.count, 'E2E bookings left behind').toBe(0)
  expect(closures.count, 'E2E closures left behind').toBe(0)
})

/** Opens the Closures tab as a fresh admin and picks the dates by calendar ("Pick dates"). */
async function openClosures(page: Page, date: string) {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/schedule')
  await page.getByRole('tab', { name: 'Closures' }).click()
  await expect(page).toHaveURL(/tab=closures/)
  await expect(page.getByRole('heading', { level: 2, name: 'Closures' })).toBeVisible()
  await page.getByRole('group', { name: 'Which days' }).getByRole('button', { name: 'Pick dates' }).click()
  await pickDate(page, page, 'Starts on', date)
}

/** Removes a listed closure through the app's own dialog. */
async function removeClosure(page: Page, listed: ReturnType<Page['getByRole']>, courtName: string) {
  const opener = listed.getByRole('button', { name: `Remove closure: ${courtName}` })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Remove this closure?' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('The time will become bookable again.')
  expect(await axeViolations(page), 'the remove dialog').toEqual([])
  await dialog.getByRole('button', { name: 'Remove closure', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(listed).toHaveCount(0)
}

test('an admin adds a timed closure with the pickers, and a guest picking that date in the calendar sees it closed', async ({ page, browser }) => {
  await openClosures(page, date)
  const reason = `${E2E_PREFIX} Floor repair ${Date.now()}`
  await page.getByRole('combobox', { name: 'Court', exact: true }).selectOption({ label: 'Badminton 2' })
  await page.getByLabel('Reason (staff only)').fill(reason)
  await page.getByRole('checkbox', { name: 'All day' }).uncheck()

  // The calendar dialog, open: axe and the 360px fit.
  await page.getByRole('group', { name: 'Ends on' }).getByRole('button', { name: /^Choose a date/ }).click()
  const calendar = page.getByRole('dialog', { name: 'Ends on' })
  await expect(calendar.getByRole('grid')).toBeVisible()
  // Let the dialog's open animation finish: axe would otherwise read mid-fade colors.
  await calendar.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((anim: { finished: Promise<unknown> }) => anim.finished)))
  expect(await axeViolations(page), 'the open calendar').toEqual([])
  expect(await overflow(page), 'the calendar scrolls sideways').toBeLessThanOrEqual(0)
  const box = await calendar.boundingBox()
  const grid = await calendar.getByRole('grid').boundingBox()
  expect(grid && box && grid.x + grid.width <= box.x + box.width, 'the month fits inside the dialog').toBe(true)
  await page.keyboard.press('Escape')
  await expect(calendar).toBeHidden()

  await page.getByRole('group', { name: 'Starts at' }).getByRole('radio', { name: '2 PM', exact: true }).check()
  await page.getByRole('group', { name: 'Ends at' }).getByRole('radio', { name: '4 PM', exact: true }).check()
  // The summary states the real range before anything is added.
  await expect(page.getByRole('status', { name: 'Closure summary' })).toContainText('2:00 PM')
  await expect(page.getByRole('status', { name: 'Closure summary' })).toContainText('4:00 PM')
  expect(await axeViolations(page), 'the closure form').toEqual([])
  expect(await overflow(page), 'the form scrolls sideways').toBeLessThanOrEqual(0)
  await page.getByRole('button', { name: 'Add closure' }).click()
  const listed = page.getByRole('listitem').filter({ hasText: reason })
  await expect(listed).toBeVisible()
  await expect(listed).toContainText('Badminton 2')
  await expect(listed).toContainText('2:00 PM')
  await expect(listed).toContainText('4:00 PM')

  // A guest goes to /book and picks the date in the calendar; the URL follows.
  const guestContext = await browser.newContext({ ...test.info().project.use })
  const guest = await guestContext.newPage()
  await guest.goto('/book?sport=badminton')
  await expect(guest.getByRole('group', { name: 'Date' }).getByRole('button', { name: /, today$/ })).toHaveAttribute('aria-pressed', 'true')
  await pickDate(guest, guest, 'Date', date)
  await expect(guest).toHaveURL(new RegExp(`date=${date}`))
  // One merged cell for the whole closure (T10.5); players see only "Closed", never the staff reason.
  await expect(guest.getByRole('button', { name: 'Badminton 2, 2 PM – 4 PM, Closed' })).toBeDisabled()
  await expect(guest.getByRole('button', { name: /^Badminton 2, 3 PM – 4 PM/ })).toHaveCount(0)
  await expect(guest.getByRole('button', { name: /^Badminton 2, 4 PM – 5 PM, ₱/ })).toBeEnabled()
  await expect(guest.getByText(reason)).toHaveCount(0)
  expect(await overflow(guest), '/book scrolls sideways').toBeLessThanOrEqual(0)
  await guestContext.close()

  // Removing it frees the slots again.
  await removeClosure(page, listed, 'Badminton 2')
})

test('an admin closes a whole day for all courts, and a guest sees every court closed that day', async ({ page, browser }) => {
  const wholeDay = venueDate(24)
  await openClosures(page, wholeDay)
  const reason = `${E2E_PREFIX} Holiday ${Date.now()}`
  await expect(page.getByRole('checkbox', { name: 'All day' })).toBeChecked()
  await page.getByRole('group', { name: 'Reason' }).getByRole('button', { name: 'Holiday' }).click()
  await expect(page.getByLabel('Reason (staff only)')).toHaveValue('Holiday')
  await page.getByLabel('Reason (staff only)').fill(reason)
  await expect(page.getByRole('status', { name: 'Closure summary' })).toContainText('No bookings or open play in this time.')
  expect(await axeViolations(page), 'the whole-day closure form').toEqual([])
  await page.getByRole('button', { name: 'Add closure' }).click()
  const listed = page.getByRole('listitem').filter({ hasText: reason })
  await expect(listed).toBeVisible()
  await expect(listed).toContainText('All courts')

  const guestContext = await browser.newContext({ ...test.info().project.use })
  const guest = await guestContext.newPage()
  await guest.goto(`/book?date=${wholeDay}&sport=badminton`)
  await expect(guest.getByRole('button', { name: /^Badminton 1, .*Closed$/ }).first()).toBeDisabled()
  await expect(guest.getByRole('button', { name: /^Badminton 1, .*₱/ })).toHaveCount(0)
  await guestContext.close()

  await removeClosure(page, listed, 'All courts')
})

test('the form lists a booking already in the time, links to it, and cancels nothing', async ({ page }) => {
  const booked = venueDate(22)
  // 2 PM Manila is 06:00 UTC. Bookings are written directly (online bookings need a payment flow); try each badminton court.
  const service = serviceClient()
  const { data: courts } = await service.from('courts').select('id, name').eq('sport', 'badminton').eq('is_active', true).order('sort_order')
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const reference = `CB-${Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')}`
  const token = randomBytes(24).toString('base64url')
  let booking: { id: string; court_id: string } | null = null
  for (const court of courts ?? []) {
    const { data } = await service.from('bookings').insert({
      reference_code: reference, court_id: court.id, guest_name: `${E2E_PREFIX} Closure Guest`, guest_email: `e2e-closure-${Date.now()}@example.com`,
      guest_phone: '0917 000 7777', during: `[${booked}T06:00:00Z,${booked}T07:00:00Z)`, total_amount: 600, status: 'confirmed', source: 'online',
      guest_token_hash: `\\x${createHash('sha256').update(token).digest('hex')}`,
    }).select('id, court_id').maybeSingle()
    if (data) { booking = data; break }
  }
  test.skip(!booking, 'No badminton court is free on that day.')

  await openClosures(page, booked)
  await page.getByRole('checkbox', { name: 'All day' }).uncheck()
  await page.getByRole('group', { name: 'Starts at' }).getByRole('radio', { name: '1 PM', exact: true }).check()
  await page.getByRole('group', { name: 'Ends at' }).getByRole('radio', { name: '4 PM', exact: true }).check()
  const summary = page.getByRole('status', { name: 'Closure summary' })
  await expect(summary.getByRole('heading', { name: 'Already booked in this time' })).toBeVisible()
  const link = summary.getByRole('link', { name: new RegExp(reference) })
  await expect(link).toHaveAttribute('href', new RegExp(`/admin/bookings.*booking=${booking?.id}`))
  await expect(summary).toContainText('They stay booked. Nothing is cancelled or moved.')
  expect(await axeViolations(page), 'the booking warning').toEqual([])
  expect(await overflow(page), 'the warning scrolls sideways').toBeLessThanOrEqual(0)

  // Adding the closure leaves the booking as it was.
  await page.getByLabel('Reason (staff only)').fill(`${E2E_PREFIX} Event ${Date.now()}`)
  await page.getByRole('button', { name: 'Add closure' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: `${E2E_PREFIX} Event` })).toBeVisible()
  const { data: after } = await service.from('bookings').select('status').eq('id', booking?.id ?? '').single()
  expect(after?.status).toBe('confirmed')
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
