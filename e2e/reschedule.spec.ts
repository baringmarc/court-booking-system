// Staff reschedule a confirmed booking (SPEC §4, T10.10): the whole booking before it starts, and a split once it has
// begun. The guest sees the move through their private link and gets an email; the admin's views follow.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { createAdmin, E2E_PREFIX, emailText, logInAdmin, pickDate, pickFirstFreeSlot, runEmailWorker, serviceClient, uploadProof, venueDate, setColorScheme } from './support/helpers.ts'

// Guest links keep the token in the fragment, so leave the page first to reload it (as the other specs do).
async function openGuestLink(page: Page, url: string) {
  await page.goto('about:blank')
  await page.goto(url)
}

async function axeViolations(page: Page, name: string) {
  for (const colorScheme of ['light', 'dark'] as const) {
    await setColorScheme(page, colorScheme)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(
      results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${colorScheme} ${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      name,
    ).toEqual([])
  }
  await page.emulateMedia({ colorScheme: null })
}

type Hours = { day_of_week: number; open_time: string; close_time: string; is_closed: boolean }
let originalHours: Hours[] = []

// The split test opens the venue 6 AM to 5 AM (overnight) so it runs at nearly any time of day; opening hours are venue-wide, so put them
// back for the other specs, even when it fails.
test.afterEach(async () => {
  for (const row of originalHours) {
    const { error } = await serviceClient().from('operating_hours')
      .update({ open_time: row.open_time, close_time: row.close_time, is_closed: row.is_closed }).eq('day_of_week', row.day_of_week)
    if (error) throw error
  }
  originalHours = []
})

/** At 360px the page must reflow rather than scroll sideways (a string, because the e2e tsconfig has no DOM types). */
async function expectNoSidewaysScroll(page: Page, name: string) {
  const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0)
}

test('staff move a confirmed booking before it starts: the guest sees it and gets an email', async ({ page, browser }) => {
  // The guest books and pays by proof; the admin approves it.
  await pickFirstFreeSlot(page, { date: venueDate(9), sport: 'badminton', court: 'Badminton 1' })
  const email = `e2e-move-${Date.now()}@example.com`
  await page.getByLabel('Name').fill(`${E2E_PREFIX} Mover`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mobile number (optional)').fill('0917 000 7777')
  await page.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
  const url = page.url()
  const reference = new URL(url).pathname.split('/').pop()!
  await uploadProof(page)

  const admin = await createAdmin()
  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await logInAdmin(adminPage, admin.email, admin.password, `/admin/bookings?status=all&date=${venueDate(9)}`)
  await adminPage.getByRole('button', { name: new RegExp(reference) }).click()
  // Only a confirmed booking can be moved.
  await expect(adminPage.getByRole('button', { name: 'Reschedule' })).toHaveCount(0)
  await adminPage.getByRole('button', { name: 'Approve and confirm' }).click()
  await expect(adminPage.getByRole('status').filter({ hasText: `${reference} is confirmed` })).toBeVisible()
  await adminPage.getByRole('button', { name: new RegExp(reference) }).click()

  await adminPage.getByRole('button', { name: 'Reschedule' }).click()
  const form = adminPage.getByRole('form', { name: 'Reschedule booking' })
  // Not started: no "Move from" choice. Only courts of the booking's sport are offered.
  await expect(form.getByRole('group', { name: 'Move from' })).toHaveCount(0)
  await expect(form.getByLabel('New court').locator('option')).toHaveText(['Badminton 1', 'Badminton 2', 'Badminton 3', 'Badminton 4'])

  // Required: a reason (the player sees it).
  await form.getByLabel('New court').selectOption({ label: 'Badminton 4' })
  await pickDate(adminPage, form, 'New date', venueDate(10))
  const starts = form.getByRole('group', { name: 'New start' })
  await expect(starts).toBeVisible()
  const chosenStart = ((await starts.locator('label').first().textContent()) ?? '').trim()
  await starts.locator('label').first().click()
  await form.getByRole('button', { name: 'Move booking' }).click()
  await expect(form.getByRole('alert')).toHaveText('Give a reason so the player knows why.')

  await axeViolations(adminPage, 'reschedule form')
  await expectNoSidewaysScroll(adminPage, 'reschedule form')

  await form.getByLabel('Reason for moving').fill('E2E rain on the court')
  await form.getByRole('button', { name: 'Move booking' }).click()
  await expect(adminPage.getByRole('status').filter({ hasText: new RegExp(`${reference} moved to Badminton 4`) })).toBeVisible()
  await adminContext.close()

  // The guest's page shows the new court and why.
  await openGuestLink(page, url)
  await expect(page.getByRole('heading', { name: 'Badminton 4' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Schedule changes' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Changes' })).toContainText('Reason: E2E rain on the court')
  await expect(page.getByRole('list', { name: 'Changes' })).toContainText('(Badminton 4)')
  // The booking itself shows the new date and start hour.
  const newDate = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(`${venueDate(10)}T12:00:00+08:00`))
  await expect(page.getByRole('definition').filter({ hasText: newDate })).toBeVisible()
  await expect(page.getByRole('definition').filter({ hasText: new RegExp(`^${chosenStart}–`) })).toBeVisible()
  await axeViolations(page, 'booking page with a change')
  await expectNoSidewaysScroll(page, 'booking page with a change')

  // One email, to the guest, with no private link (the token is never stored).
  await runEmailWorker()
  const mail = await emailText(email, new RegExp(`^Booking ${reference} was moved$`))
  expect(mail).toContain('Moved to: Badminton 4')
  expect(mail).toContain('Was: Badminton 1')
  expect(mail).toContain('Reason: E2E rain on the court')
  expect(mail).not.toContain('#token=')
})

test('staff split a booking that has begun: both parts are visible to the guest', async ({ page, browser }) => {
  // The hour in progress and the one after it, on the same operating day. While this test runs every day is open
  // 6 AM until 5 AM the next day (overnight, T9.10), so the pair may cross midnight; only 4–6 AM is closed.
  const manila = new Date(Date.now() + 8 * 3_600_000)
  const manilaHour = manila.getUTCHours()
  test.skip(manilaHour === 4 || manilaHour === 5 || manila.getUTCMinutes() >= 55, 'Needs the next two hours inside opening hours, and the hour not about to end.')
  const start = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000)
  const end = new Date(start.getTime() + 2 * 3_600_000)

  const service = serviceClient()
  const { data: hours, error: hoursError } = await service.from('operating_hours').select('day_of_week, open_time, close_time, is_closed')
  if (hoursError) throw hoursError
  originalHours = hours
  const { error: openError } = await service.from('operating_hours').update({ open_time: '06:00:00', close_time: '05:00:00', is_closed: false }).in('day_of_week', [0, 1, 2, 3, 4, 5, 6])
  if (openError) throw openError

  // A started booking can't be made through the app (online bookings start in the future), so it's inserted directly.
  const { data: courts } = await service.from('courts').select('id, name').eq('sport', 'badminton').eq('is_active', true).order('sort_order')
  const token = randomBytes(24).toString('base64url')
  const email = `e2e-split-${Date.now()}@example.com`
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const reference = `CB-${Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')}`
  let booking: { id: string; court_id: string } | null = null
  let lastError = ''
  for (const court of courts ?? []) {
    const { data, error } = await service.from('bookings').insert({
      reference_code: reference, court_id: court.id, guest_name: `${E2E_PREFIX} Splitter`, guest_email: email, guest_phone: '0917 000 8888',
      during: `[${start.toISOString()},${end.toISOString()})`, total_amount: 600, status: 'confirmed', source: 'online',
      guest_token_hash: `\\x${createHash('sha256').update(token).digest('hex')}`,
    }).select('id, court_id').maybeSingle()
    if (data) { booking = data; break }
    lastError = error?.message ?? ''
  }
  test.skip(!booking, `No badminton court is free for the next two hours (${lastError}).`)
  const url = `/booking/${reference}#token=${token}`

  const admin = await createAdmin()
  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await logInAdmin(adminPage, admin.email, admin.password, `/admin/bookings?status=all&date=${venueDate(0)}`)
  await adminPage.getByRole('button', { name: new RegExp(reference) }).click()
  await adminPage.getByRole('button', { name: 'Reschedule' }).click()
  const form = adminPage.getByRole('form', { name: 'Reschedule booking' })

  // Started: choose where the move begins. The hour in progress is first; move only the later hour.
  const from = form.getByRole('group', { name: 'Move from' })
  await expect(from.getByRole('radio')).toHaveCount(2)
  await from.locator('label').nth(1).click()
  await expect(form).toContainText('Moving 1 hour')
  await expect(form).toContainText('become a booking of their own')

  await form.getByRole('button', { name: 'Tomorrow' }).click()
  const starts = form.getByRole('group', { name: 'New start' })
  await expect(starts).toBeVisible()
  await expectNoSidewaysScroll(adminPage, 'split form')
  await starts.locator('label').first().click()
  await form.getByLabel('Reason for moving').fill('E2E net broke')
  await form.getByRole('button', { name: 'Move booking' }).click()
  const status = adminPage.getByRole('status').filter({ hasText: /The moved hours are CB-/ })
  await expect(status).toBeVisible()
  const moved = (await status.textContent())!.match(/The moved hours are (CB-[A-Z0-9]{6})/)![1]

  // The admin's list shows the original shortened to its first hour (it was two hours before the split).
  const hourLabel = (h: number) => `${h % 12 || 12} ${h % 24 < 12 ? 'AM' : 'PM'}`
  const startHour = (Math.floor(Date.now() / 3_600_000) + 8) % 24
  const panel = adminPage.getByRole('region', { name: `Booking ${reference}` })
  await expect(panel.getByRole('term').filter({ hasText: 'When' }).locator('xpath=following-sibling::dd'))
    .toHaveText(new RegExp(`${hourLabel(startHour)}–${hourLabel(startHour + 1)}$`))

  // The dashboard's day view follows: the booking is one hour over its court, and the moved part (tomorrow) isn't there.
  await adminPage.goto('/admin')
  const dayView = adminPage.getByRole('region', { name: "Today's courts" })
  const cell = dayView.getByRole('cell').filter({ has: adminPage.getByRole('link', { name: reference }) })
  await expect(cell).toBeVisible()
  await expect(cell).not.toHaveAttribute('rowspan', /.+/)
  await expect(dayView.getByRole('link', { name: moved })).toHaveCount(0)
  await adminContext.close()

  // The guest sees both parts through the same private link.
  await openGuestLink(page, url)
  await expect(page.getByRole('heading', { name: 'Schedule changes' })).toBeVisible()
  const parts = page.getByRole('list', { name: 'Moved parts' })
  await expect(parts).toContainText('1 hour moved to')
  await parts.getByRole('link', { name: moved }).click()
  await expect(page.getByText(/moved part of/i)).toContainText(reference)
  await expect(page.getByRole('heading', { name: 'Your booking' })).toBeVisible()
  await axeViolations(page, 'moved part page')
  await expectNoSidewaysScroll(page, 'moved part page')

  await runEmailWorker()
  const mail = await emailText(email, new RegExp(`^Booking ${reference} was moved$`))
  expect(mail).toContain(`The moved hours have their own reference, ${moved}.`)
})
