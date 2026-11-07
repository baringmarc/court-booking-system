// Owner manual screenshots from a throwaway local venue only.
// Run: node scripts/with-lock.mjs node --experimental-strip-types docs/owner-manual/capture.mjs
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, chromium } from '@playwright/test'
import { createServer } from 'vite'
import { localSupabase } from '../../e2e/support/local.ts'
import { serviceClient, createVenue, deleteVenue, venueDate } from '../../e2e/support/helpers.ts'

const local = localSupabase()
process.env.VITE_SUPABASE_URL = local.url
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = local.publishableKey
const dir = fileURLToPath(new URL('./screens/', import.meta.url))
await mkdir(dir, { recursive: true })
const service = serviceClient()
const port = 5197
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' })
await server.listen()
const PASSWORD = 'Manual-demo-2026'
let browser, venue, userId, proofPath, oldFee

// Callouts are drawn into the page, so the image and the numbered steps in the manual always agree.
const CALLOUT = 'position:fixed;z-index:99999;width:26px;height:26px;border-radius:50%;background:#7a3f2c;color:#fff;' +
  'font:700 15px/26px system-ui,sans-serif;text-align:center;box-shadow:0 0 0 3px #fff;pointer-events:none'

try {
  // Show the real fee, so the amounts in the manual match what a player actually transfers.
  oldFee = (await service.from('platform_pricing').select('booking_fee').single().throwOnError()).data.booking_fee
  await service.from('platform_pricing').update({ booking_fee: 10 }).eq('id', true).throwOnError()

  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light', timezoneId: 'Asia/Manila' })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)

  venue = await createVenue('manualc')
  await service.from('venues').update({ status: 'draft' }).eq('id', venue.id).throwOnError()
  await service.from('venue_settings').update({ name: 'Garden Courts' }).eq('venue_id', venue.id).throwOnError()
  await service.from('courts').delete().eq('venue_id', venue.id).throwOnError()
  await service.from('venue_schedule_state').update({ schedule_v2_active: true }).eq('venue_id', venue.id).select().single().throwOnError()

  // An invited owner, exactly like a real first access: invited, with no password chosen yet.
  const email = `e2e-manualc-${Date.now().toString(36)}@example.com`
  const invited = await service.auth.admin.inviteUserByEmail(email)
  if (invited.error) throw invited.error
  userId = invited.data.user.id
  const pw = await service.auth.admin.updateUserById(userId, { password: PASSWORD, email_confirm: true })
  if (pw.error) throw pw.error
  await service.from('venue_members').insert({ venue_id: venue.id, user_id: userId, role: 'owner' }).throwOnError()

  const base = `http://${venue.slug}.localhost:${port}`
  const visit = (path) => page.goto(`${base}/admin${path}`)
  const region = (name) => page.getByRole('region', { name, exact: true })
  const button = (name) => page.getByRole('button', { name, exact: true })

  async function mark(items) {
    for (let [locator, n, where = 'left'] of items) {
      await locator.scrollIntoViewIfNeeded()
      // 'text' puts the badge just after the element's own text, not its full-width box.
      const box = where === 'text' ? await locator.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        const range = document.createRange(); range.selectNodeContents(walker.nextNode())
        const r = range.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }
      }) : await locator.boundingBox()
      if (where === 'text') where = 'right'
      await page.evaluate(({ box, n, where, css }) => {
        const b = document.createElement('div')
        b.className = 'manual-callout'
        b.textContent = String(n)
        b.style.cssText = css
        const x = where === 'right' ? box.x + box.width + 6 : where === 'below' ? box.x + box.width / 2 - 13 : box.x - 32
        b.style.left = Math.max(2, x) + 'px'
        b.style.top = (where === 'below' ? box.y + box.height + 4 : box.y + box.height / 2 - 13) + 'px'
        document.body.append(b)
      }, { box, n, where, css: CALLOUT })
    }
  }
  const unmark = () => page.evaluate(() => document.querySelectorAll('.manual-callout').forEach((n) => n.remove()))

  async function shot(name, element, { pad = 0, callouts = [], target = page, until } = {}) {
    await element.waitFor()
    await element.scrollIntoViewIfNeeded()
    await target.evaluate(() => document.fonts.ready)
    await target.waitForTimeout(250)
    if (callouts.length) await mark(callouts)
    const box = await element.boundingBox()
    if (until) { const end = await until.boundingBox(); box.height = end.y + end.height - box.y; box.width = Math.max(box.width, end.x + end.width - box.x) }
    const vp = target.viewportSize()
    const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad) }
    clip.width = Math.min(vp.width - clip.x, box.width + pad * 2)
    clip.height = Math.min(vp.height - clip.y, box.height + pad * 2)
    // JPEG at roughly 2x the size printed keeps the PDF small enough to email.
    await target.screenshot({ path: dir + name + '.jpg', type: 'jpeg', quality: 82, clip, animations: 'disabled', scale: clip.width > 900 ? 'css' : 'device' })
    if (callouts.length) await unmark()
    console.log('Captured', name)
  }

  // 1. First access
  await visit('')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await button('Sign in').click()
  await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible()
  await page.setViewportSize({ width: 760, height: 900 })
  await shot('set-password', page.locator('form').filter({ has: button('Set password') }), { pad: 16 })
  const fields = page.locator('form').filter({ has: button('Set password') }).locator('input[type=password]')
  await fields.nth(0).fill(PASSWORD + '!')
  await fields.nth(1).fill(PASSWORD + '!')
  await button('Set password').click()
  await expect(region('Set up your venue')).toContainText('Publish venue')

  // 2. Admin at a glance (desktop, draft)
  await page.setViewportSize({ width: 1180, height: 820 })
  await page.waitForTimeout(400)
  const nav = page.getByRole('navigation', { name: 'Admin' })
  await shot('overview', page.locator('body'), { callouts: [
    [nav.getByRole('link', { name: 'Dashboard' }), 1, 'right'],
    [region('Set up your venue').getByText(/of 5 done/), 2],
    [page.getByRole('link', { name: 'View public site' }).first(), 3, 'below'],
    [nav.getByRole('link', { name: 'Settings' }), 4, 'right'],
  ] })

  // 3. Court
  await page.setViewportSize({ width: 760, height: 1000 })
  await visit('/courts/new')
  await page.getByLabel('Name', { exact: true }).fill('Garden Court 1')
  await page.getByLabel('Sport').selectOption('pickleball')
  await page.getByLabel('Default hourly rate').fill('400')
  const courtForm = page.locator('form').filter({ has: button('Create court') })
  await shot('court', courtForm, { pad: 36, callouts: [
    [courtForm.getByText('Name', { exact: true }), 1, 'text'], [courtForm.getByText('Sport', { exact: true }), 2, 'text'],
    [courtForm.getByText('Default hourly rate', { exact: true }), 3, 'text'], [button('Create court'), 4, 'right'],
  ] })
  await button('Create court').click()
  await expect(page.getByRole('heading', { name: 'Garden Court 1' })).toBeVisible()
  await visit('')
  await expect(region('Set up your venue')).toContainText('3 of 5 done')
  await shot('checklist', region('Set up your venue'), { pad: 4 })

  // 4. Schedule
  await page.setViewportSize({ width: 900, height: 1100 })
  await visit('/schedule')
  const monday = page.locator('fieldset.hours-day-row').first()
  await monday.getByRole('button', { name: /Add a break/ }).click()
  await shot('hours', monday, { pad: 36, callouts: [[monday.getByRole('switch').first(), 1], [monday.getByRole('button', { name: /Remove break/ }).first(), 2, 'right']] })
  const glance = page.getByRole('region', { name: /Week at a glance/ })
  if (await glance.count()) await shot('week', glance, { pad: 4 })
  await page.getByRole('tab', { name: 'Prices' }).click()
  await page.getByLabel('Rate from').selectOption({ label: '5 PM' })
  await page.getByLabel('Rate to').selectOption({ label: '10 PM' })
  await page.getByLabel('Override price').fill('500')
  await shot('prices-form', page.getByRole('group', { name: 'Weekly override rates' }), { pad: 36, callouts: [[page.getByLabel('Override price'), 1], [button('Apply rate'), 2]] })
  await button('Apply rate').click()
  await button('Review & save').click()
  await expect(page.getByText('No existing reservations are affected')).toBeVisible()
  await shot('review', page.getByRole('dialog', { name: 'Review changes' }))
  await button('Save changes').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(region('Unsaved changes')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Closures' }).click()
  await button('Tomorrow').click()
  await button('Maintenance').click()
  await expect(page.getByLabel('Closure summary')).toContainText('No bookings or open play')
  await shot('closure', page.locator('form').filter({ has: button('Add closure') }), { pad: 36, callouts: [
    [page.getByRole('group', { name: 'Which days' }), 1], [page.getByRole('group', { name: 'Reason' }), 2],
    [page.getByLabel('Closure summary'), 3], [button('Add closure'), 4],
  ] })

  // 5. Payments
  await page.setViewportSize({ width: 760, height: 1100 })
  await visit('/settings/payments')
  const account = page.getByRole('form', { name: 'New payment account' })
  await account.getByLabel(/^Label/).fill('GCash')
  await account.getByLabel('Account name').fill('Garden Courts')
  await account.getByLabel('Account or mobile number').fill('0917 000 0000')
  await account.getByRole('button', { name: 'Add account' }).click()
  await expect(page.getByRole('button', { name: 'Edit GCash' })).toBeVisible()
  await button('Use example').click()
  await shot('payment', page.getByRole('main'), { pad: 0 })
  await button('Save instructions').click()
  await expect(page.getByRole('form', { name: 'Payment instructions' })).toContainText('Saved')

  // 6. Booking rules
  await visit('/settings/booking')
  await shot('rules', page.locator('form').filter({ has: button('Save booking rules') }), { pad: 16 })

  // 7. Publish, then look at it as a player on a phone
  await page.setViewportSize({ width: 760, height: 1000 })
  await visit('')
  await expect(region('Set up your venue')).toContainText('5 of 5 done')
  await button('Publish venue').click()
  await expect(region('Set up your venue')).toHaveCount(0)
  // A signed-out player's view, on a phone.
  const guest = await browser.newContext({ viewport: { width: 390, height: 1400 }, deviceScaleFactor: 2, colorScheme: 'light', timezoneId: 'Asia/Manila' })
  const player = await guest.newPage()
  await player.goto(`${base}/book`)
  await expect(player.getByText('Garden Court 1').first()).toBeVisible()
  // Show next Monday: every hour still ahead, the lunch break and the ₱500 evening rate.
  const dow = new Date(venueDate(0) + 'T12:00:00Z').getUTCDay()
  for (let i = 0; i < ((8 - dow) % 7 || 7); i++) await player.getByRole('button', { name: 'Next day' }).click()
  await expect(player.getByText(/₱500/).first()).toBeVisible()
  await player.waitForTimeout(800)
  const grid = await player.getByText(/Tap a time to select it/).boundingBox()
  const jpeg = { type: 'jpeg', quality: 82, animations: 'disabled' }
  await player.screenshot({ ...jpeg, path: dir + 'public-top.jpg', clip: { x: 0, y: 0, width: 390, height: grid.y - 8 } })
  await player.screenshot({ ...jpeg, path: dir + 'public-grid.jpg', clip: { x: 0, y: grid.y - 8, width: 390, height: Math.min(940, 1400 - grid.y) } })
  console.log('Captured public-top, public-grid')
  await guest.close()

  // 8. A real-looking online booking at ₱400 + ₱10 fee, paid by transfer
  const { data: court } = await service.from('courts').select('id').eq('venue_id', venue.id).single().throwOnError()
  const today = venueDate(0)
  const { data: booking } = await service.from('bookings').insert({
    venue_id: venue.id, court_id: court.id, guest_name: 'Ana Reyes', status: 'payment_submitted', source: 'online',
    reference_code: 'CB-GARDEN', during: `[${today}T16:00+08:00,${today}T17:00+08:00)`, total_amount: 400,
  }).select('id, booking_fee, amount_due').single().throwOnError()
  if (Number(booking.amount_due) !== 410) throw new Error('Expected ₱410 due, got ' + booking.amount_due)
  const receipt = await browser.newPage({ viewport: { width: 300, height: 170 }, deviceScaleFactor: 2 })
  await receipt.setContent(`<body style="margin:0;font:15px system-ui,sans-serif;color:#1d1d1f;background:#fff">
    <div style="background:#0a5bd3;color:#fff;padding:10px 14px;font-weight:700">Transfer successful</div>
    <div style="padding:10px 14px;line-height:1.5">Sent to <b>Garden Courts</b><br>Amount <b>PHP 410.00</b><br>Ref. no. <b>GC-2468</b><br><span style="color:#666">SAMPLE RECEIPT</span></div></body>`)
  proofPath = booking.id + '/demo.png'
  const upload = await service.storage.from('payment-proofs').upload(proofPath, await receipt.screenshot(), { contentType: 'image/png' })
  if (upload.error) throw upload.error
  await receipt.close()
  await service.from('payments').insert({ venue_id: venue.id, booking_id: booking.id, method: 'gcash',
    amount: 410, reference_number: 'GC-2468', storage_path: proofPath }).throwOnError()

  await page.setViewportSize({ width: 1180, height: 1300 })
  await visit('/bookings')
  await page.getByRole('button', { name: /CB-GARDEN/ }).click()
  await expect(page.getByAltText('Proof of payment')).toBeVisible()
  await page.setViewportSize({ width: 1180, height: 2000 })
  await shot('proof', page.getByRole('heading', { name: 'Proof waiting for review' }), { pad: 34, until: button('Approve and confirm'),
    callouts: [[page.getByText(/· Ref GC-2468 ·/), 1, 'right'], [page.getByAltText('Proof of payment'), 2, 'right'], [button('Approve and confirm'), 3, 'right']] })
  await button('Approve and confirm').click()
  await expect(page.getByRole('status').filter({ hasText: /confirmed/i })).toBeVisible()

  // The local DB clock and the browser can disagree on the month; make sure the statement has this month's fee.
  const { data: charges } = await service.from('billing_charges').select('id').eq('booking_id', booking.id).throwOnError()
  if (!charges.length) {
    await service.from('billing_charges').insert({ venue_id: venue.id, booking_id: booking.id,
      billing_month: today.slice(0, 7) + '-01', kind: 'booking_fee', amount: 10 }).throwOnError()
  }

  // 9. Dashboard after the first paid booking
  await page.setViewportSize({ width: 900, height: 1200 })
  await visit('')
  await expect(page.getByRole('list', { name: 'Revenue split' })).toContainText('₱410')
  await shot('earnings', page.getByRole('list', { name: 'Revenue split' }), { pad: 4 })
  await shot('day-view', page.getByRole('region', { name: "Today's courts" }), { pad: 4 })

  // 10. Reports
  await visit('/reports')
  await expect(region('This month’s fees so far')).toContainText('booking fee')
  await shot('statement', region('This month’s fees so far'), { pad: 4 })

  // 11. Open Play
  await page.setViewportSize({ width: 760, height: 1300 })
  await visit('/open-play')
  await page.getByLabel(/Garden Court 1/).check()
  await page.getByLabel('Title').fill('Friday night social')
  const session = page.getByRole('form', { name: 'Open play session' })
  await shot('open-play', session, { pad: 16, until: session.getByLabel('Title') })
} finally {
  try {
    if (oldFee !== undefined) await service.from('platform_pricing').update({ booking_fee: oldFee }).eq('id', true).throwOnError()
    if (proofPath) {
      const { error } = await service.storage.from('payment-proofs').remove([proofPath])
      if (error) throw error
    }
    if (venue) {
      for (const table of ['bookings', 'venue_payment_accounts', 'blackouts', 'open_play_sessions']) {
        await service.from(table).delete().eq('venue_id', venue.id)
      }
      await deleteVenue(venue.id)
      await expect((await service.from('venues').select('id').eq('id', venue.id).throwOnError()).data).toEqual([])
    }
  } finally {
    try {
      if (userId) {
        const { error } = await service.auth.admin.deleteUser(userId)
        if (error) throw error
      }
    } finally {
      await browser?.close()
      await server.close()
    }
  }
}
