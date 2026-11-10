// Admin tour screenshots (T21.1): real pictures of the admin pages for plotline-site's admin tour (its T4.1).
// Run: npm run tour:shots. LOCAL stack only (`npx supabase start`); it starts its own Vite dev server.
//   npm run tour:shots              capture, then copy to ../plotline-site/public/admin-tour/ when that repo is checked out
//   node scripts/admin-tour.mjs --check   only check that the committed files exist and fit the size budget
// For the run it adds synthetic demo data (made-up names, e2e-tour-… emails, a ₱10 booking fee, generated court
// illustrations, never third-party photos), and afterwards removes all of it and checks that it is gone.
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import {
  addCourtPhotos, anon, at, createAdmin, env, restoreVenueInfo, service, setDemoVenueInfo, snapshotVenueInfo, TZ, venueDate,
} from './lib/local-demo.mjs'

const OUT = 'docs/admin-tour'
const SITE_OUT = '../plotline-site/public/admin-tour'
const PORT = 5189
const BASE = `http://127.0.0.1:${PORT}`
const TAG = 'e2e-tour' // the demo admin is e2e-e2e-tour-admin-…@example.com; guests end in +tour@example.com

/** The files plotline-site relies on. Names are stable; `budget` is the largest size in bytes a landing page can afford. */
const DESKTOP_BUDGET = 230_000
const PHONE_BUDGET = 260_000
const FILES = [
  ...['dashboard', 'earnings', 'bookings', 'schedule', 'open-play', 'courts', 'reports', 'settings'].map((name) => `${name}-desktop.png`),
  ...['dashboard', 'bookings'].map((name) => `${name}-phone.png`),
]
const budgetOf = (file) => (file.endsWith('-phone.png') ? PHONE_BUDGET : DESKTOP_BUDGET)

async function checkFiles(dir = OUT) {
  const problems = []
  for (const file of FILES) {
    try {
      const { size } = await stat(`${dir}/${file}`)
      if (size > budgetOf(file)) problems.push(`${file} is ${size} bytes, over its ${budgetOf(file)} byte budget`)
    } catch {
      problems.push(`${file} is missing`)
    }
  }
  return problems
}

if (process.argv.includes('--check')) {
  const problems = await checkFiles()
  for (const p of problems) console.error(p)
  console.log(problems.length ? 'Admin tour files: NOT OK' : `Admin tour files: OK (${FILES.length} files within budget)`)
  process.exit(problems.length ? 1 : 0)
}

const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }
const PHONE = { viewport: { width: 360, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

// --- A receipt for the payment proof ------------------------------------------------------------------------

const receiptHtml = (amount, ref) => `<body style="margin:0;background:#eef2f7;font-family:Helvetica,Arial,sans-serif">
<div style="width:420px;margin:0 auto;padding:36px 30px;background:#fff;min-height:560px">
  <div style="color:#0b63f6;font-weight:700;font-size:26px">GCash</div>
  <div style="margin-top:22px;color:#3a4252;font-size:17px">Express Send</div>
  <div style="font-size:38px;font-weight:700;margin:10px 0 18px">₱${amount}.00</div>
  <div style="border-top:1px solid #dde2ea;padding-top:14px;color:#5b6577;font-size:14px;line-height:2">
    Sent to<br><b style="color:#1d2433">CLAUDEX COURTS</b><br>
    Reference No.<br><b style="color:#1d2433">${ref}</b><br>
    Status<br><b style="color:#1a8a4a">Successful</b>
  </div>
</div></body>`

// --- Main -----------------------------------------------------------------------------------------------------

/** Removes everything this script makes, found by its e2e-tour tag. Returns what was still there afterwards. */
async function purge(made) {
  const { data: leftovers } = await service.from('bookings').select('id').like('guest_email', '%+tour@example.com').throwOnError()
  const ids = [...new Set([...(leftovers ?? []).map((b) => b.id), ...made.bookingIds])]
  if (ids.length) {
    await service.storage.from('payment-proofs').remove(ids.map((id) => `${id}/proof.png`))
    await service.from('bookings').delete().in('id', ids).throwOnError()
  }
  const { data: users } = await service.auth.admin.listUsers({ perPage: 1000 })
  for (const user of (users?.users ?? []).filter((u) => u.email?.startsWith(`e2e-${TAG}-`))) {
    const { error } = await service.auth.admin.deleteUser(user.id)
    if (error) throw error
  }
}

/** What is still there after cleanup; empty means clean. */
async function leftovers(made) {
  const found = []
  const { count: bookings } = await service.from('bookings').select('id', { count: 'exact', head: true }).like('guest_email', '%+tour@example.com').throwOnError()
  if (bookings) found.push(`${bookings} tagged bookings`)
  const { data: users } = await service.auth.admin.listUsers({ perPage: 1000 })
  const stray = (users?.users ?? []).filter((u) => u.email?.startsWith(`e2e-${TAG}-`)).length
  if (stray) found.push(`${stray} tagged users`)
  if (made.sessionIds.length) {
    const { count } = await service.from('open_play_sessions').select('id', { count: 'exact', head: true }).in('id', made.sessionIds).throwOnError()
    if (count) found.push(`${count} open play sessions`)
  }
  if (made.photos.length) {
    const { count } = await service.from('court_photos').select('id', { count: 'exact', head: true }).in('id', made.photos.map((p) => p.id)).throwOnError()
    if (count) found.push(`${count} court photos`)
  }
  const { data: pricing } = await service.from('platform_pricing').select('booking_fee').eq('id', true).single().throwOnError()
  if (Number(pricing.booking_fee) !== Number(made.originalFee)) found.push(`the booking fee (${pricing.booking_fee}, was ${made.originalFee})`)
  return found
}

async function main() {
  await mkdir(OUT, { recursive: true })
  process.env.VITE_SUPABASE_URL = env.API_URL
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = env.PUBLISHABLE_KEY
  const server = await createServer({ server: { port: PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' })
  await server.listen()
  const browser = await chromium.launch()
  const helper = await browser.newPage()
  const venueInfo = await snapshotVenueInfo()
  const { data: pricing } = await service.from('platform_pricing').select('booking_fee').eq('id', true).single().throwOnError()
  const made = { photos: [], bookingIds: [], sessionIds: [], originalFee: pricing.booking_fee }
  let cleaned = false

  async function cleanup() {
    if (cleaned) return
    cleaned = true
    const step = async (what, fn) => {
      try {
        await fn()
      } catch (error) {
        console.error(`Cleanup failed (${what}):`, error.message ?? error)
        process.exitCode = 1
      }
    }
    await step('bookings and users', () => purge(made))
    if (made.sessionIds.length) await step('open play sessions', () => service.from('open_play_sessions').delete().in('id', made.sessionIds).throwOnError())
    if (made.photos.length) {
      await step('court photo rows', () => service.from('court_photos').delete().in('id', made.photos.map((p) => p.id)).throwOnError())
      await step('court photo files', async () => {
        const { error } = await service.storage.from('venue-media').remove(made.photos.map((p) => p.path))
        if (error) throw error
      })
    }
    await step('venue info', () => restoreVenueInfo(venueInfo))
    await step('booking fee', () => service.from('platform_pricing').update({ booking_fee: made.originalFee }).eq('id', true).throwOnError())
    await step('check', async () => {
      const left = await leftovers(made)
      if (left.length) throw new Error(`still there: ${left.join(', ')}`)
      console.log('Cleanup checked: no demo data left.')
    })
    await step('browser', () => browser.close())
    await step('dev server', () => server.close())
  }
  process.once('SIGINT', () => {
    console.error('Interrupted: removing the demo data…')
    cleanup().finally(() => process.exit(130))
  })

  try {
    await purge(made) // a crashed earlier run
    await service.from('platform_pricing').update({ booking_fee: 10 }).eq('id', true).throwOnError()
    made.photos = await addCourtPhotos(helper)
    await setDemoVenueInfo()
    const admin = await createAdmin(`${TAG}-admin`, 'Demo Owner')
    const adminClient = anon()
    await adminClient.auth.signInWithPassword({ email: admin.email, password: admin.password })

    // The pictures show a mid-morning on the venue's today (the browser clock is frozen at 9 AM below), so the
    // capture doesn't depend on when it runs. The bookings are made through create_booking in free future slots and
    // then moved to their day and hour, because the RPC refuses the past.
    const NOW_HOUR = 9
    const first = 10
    const today = venueDate(0)
    const { data: courts } = await service.from('courts').select('id, name, sport').eq('is_active', true).throwOnError()
    const court = (name) => courts.find((c) => c.name === name)
    let n = 0
    const guest = (name) => ({ p_guest_name: name, p_guest_email: `${name.toLowerCase().replace(' ', '.')}+tour@example.com`, p_guest_phone: `0917 555 01${String(10 + n++).padStart(2, '0')}` })
    let lane = 0
    async function book(courtName, day, hour, slots, name, status) {
      const spare = lane++ // a unique day and hour, so two demo bookings never overlap before they are moved
      const { data, error } = await anon().rpc('create_booking', {
        p_court_id: court(courtName).id, p_start: at(venueDate(4 + Math.floor(spare / 12)), 6 + (spare % 12)), p_slots: slots, ...guest(name),
      })
      if (error) throw error
      const { data: priced } = await service.from('bookings').select('amount_due').eq('id', data[0].id).single().throwOnError()
      const row = { ...data[0], amount_due: priced.amount_due }
      made.bookingIds.push(row.id)
      const start = at(day, hour)
      const end = new Date(new Date(start).getTime() + slots * 3_600_000).toISOString()
      await service.from('bookings').update({ during: `[${start},${end})`, ...(status ? { status } : {}) }).eq('id', row.id).throwOnError()
      // Paid an hour before the play time (the morning for today's bookings), so "collected today" counts only today's.
      const paidAt = at(day, day === today ? 8 : hour - 1)
      if (status === 'confirmed') {
        await service.from('payments').insert({ booking_id: row.id, method: 'gcash', amount: row.amount_due, reference_number: `GC-${row.reference_code.slice(3)}`, review_status: 'approved', submitted_at: paidAt, reviewed_at: paidAt }).throwOnError()
      }
      return row
    }

    // Today: two confirmed bookings (the earlier is the "next booking") and one payment proof waiting for a review.
    const firstBooking = await book('Pickleball 1', today, first, 2, 'Ana Santos', 'confirmed')
    await book('Badminton 2', today, first + 1, 1, 'Ben Reyes', 'confirmed')
    await book('Tennis Court', today, first + 2, 2, 'Carla Dizon', 'confirmed')
    const proofBooking = await book('Badminton 3', today, first + 1, 2, 'Diego Cruz', null)
    const amount = proofBooking.amount_due
    await helper.setViewportSize({ width: 420, height: 580 })
    await helper.setContent(receiptHtml(amount, `GC-${proofBooking.reference_code.slice(3)}`))
    const proof = await helper.screenshot({ type: 'png' })
    const { error: uploadError } = await service.storage.from('payment-proofs').upload(`${proofBooking.id}/proof.png`, proof, { contentType: 'image/png' })
    if (uploadError) throw uploadError
    await service.from('payments').insert({
      booking_id: proofBooking.id, method: 'gcash', amount, reference_number: `GC-${proofBooking.reference_code.slice(3)}`,
      storage_path: `${proofBooking.id}/proof.png`, review_status: 'pending', submitted_at: at(today, 8),
    }).throwOnError()
    await service.from('bookings').update({ status: 'payment_submitted' }).eq('id', proofBooking.id).throwOnError()

    // The days before this month's today: confirmed, paid bookings, for the earnings and the fee statement.
    const names = ['Ella Tan', 'Felix Ramos', 'Gina Lopez', 'Hugo Bautista', 'Ines Garcia', 'Jun Mercado', 'Kara Reyes', 'Leo Aquino']
    const spots = [['Badminton 1', 18, 2], ['Pickleball 2', 19, 1], ['Basketball Court', 17, 2], ['Badminton 4', 20, 1]]
    let k = 0
    for (let d = 1; d <= 6; d++) {
      const day = venueDate(-d)
      if (day.slice(0, 7) !== today.slice(0, 7)) break
      for (const [courtName, hour, slots] of [spots[d % 4], spots[(d + 1) % 4]]) {
        await book(courtName, day, hour, slots, names[k++ % names.length], 'confirmed')
      }
    }

    // Three open play sessions in the days ahead (the list on the page reads better with more than one).
    const { data: courtIds } = await service.from('courts').select('id, sport').eq('is_active', true).throwOnError()
    const idsOf = (sport) => courtIds.filter((c) => c.sport === sport).map((c) => c.id)
    for (const [days, sport, from, to, title, details, links] of [
      [3, 'pickleball', 10, 12, 'Open play: all levels', 'All levels welcome. ₱150 per head, paid at the counter.\nPaddles available to borrow.', [{ label: 'RSVP form', url: 'https://forms.gle/claudex-open-play' }]],
      [5, 'badminton', 18, 20, 'Beginners badminton night', 'Beginner friendly. Bring your own racket, shuttles provided.', []],
      [6, 'basketball', 16, 18, 'Pick-up basketball', 'Half-court games, ₱100 per head.', [{ label: 'Group chat', url: 'https://m.me/claudexcourts' }]],
    ]) {
      const { data: session, error: sessionError } = await adminClient.rpc('create_open_play', {
        p_court_ids: idsOf(sport), p_start: at(venueDate(days), from), p_end: at(venueDate(days), to), p_title: title, p_details: details, p_links: links,
      })
      if (sessionError) throw sessionError
      made.sessionIds.push(session)
    }

    // --- Shots ---------------------------------------------------------------------------------------------------
    const shoot = async (page, file) => {
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.screenshot({ path: `${OUT}/${file}` })
      console.log(`  ${file}`)
    }
    async function signedIn(device) {
      const context = await browser.newContext({ ...device, timezoneId: TZ, colorScheme: 'light', reducedMotion: 'reduce' })
      await context.clock.setFixedTime(new Date(at(today, NOW_HOUR)))
      const page = await context.newPage()
      await page.goto(`${BASE}/admin/login`)
      await page.getByLabel('Email').fill(admin.email)
      await page.getByLabel('Password').fill(admin.password)
      await page.getByRole('button', { name: 'Log in' }).click()
      await page.getByRole('heading', { name: "Today's courts" }).waitFor()
      return { context, page }
    }
    // Instant scrolls: the app's smooth scrolling would still be moving when the picture is taken.
    const top = (page) => page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    const scrollTo = (locator, offset = 0) => locator.evaluate((el, off) => {
      el.scrollIntoView({ block: 'start', behavior: 'instant' })
      window.scrollBy({ top: -off, behavior: 'instant' })
    }, offset)

    const desktop = await signedIn(DESKTOP)
    const page = desktop.page
    console.log('desktop:')
    await top(page)
    await shoot(page, 'dashboard-desktop.png')
    const earnings = page.getByRole('region', { name: 'Earnings' })
    await earnings.getByRole('button', { name: 'This month' }).click()
    await earnings.getByRole('list', { name: 'Collected per day' }).waitFor()
    await scrollTo(earnings)
    await shoot(page, 'earnings-desktop.png')

    await page.goto(`${BASE}/admin/bookings?status=all&date=${today}`)
    await page.getByRole('button', { name: new RegExp(proofBooking.reference_code) }).click()
    await page.getByRole('button', { name: /Approve/ }).first().waitFor()
    // The list from its first row down, so the proof, its receipt and the Approve button are all in view.
    await scrollTo(page.getByRole('button', { name: new RegExp(firstBooking.reference_code) }), 12)
    await shoot(page, 'bookings-desktop.png')

    await page.goto(`${BASE}/admin/schedule`)
    await page.getByRole('heading', { name: 'Schedule' }).waitFor()
    await scrollTo(page.getByRole('heading', { name: 'Week at a glance' }), 24)
    await shoot(page, 'schedule-desktop.png')

    await page.goto(`${BASE}/admin/open-play`)
    await page.getByText('Open play: all levels').first().waitFor()
    await scrollTo(page.getByRole('heading', { name: 'Upcoming sessions' }), 80)
    await shoot(page, 'open-play-desktop.png')

    await page.goto(`${BASE}/admin/courts`)
    await page.getByRole('heading', { name: 'Courts', level: 1 }).waitFor()
    await shoot(page, 'courts-desktop.png')

    await page.goto(`${BASE}/admin/reports`)
    await page.getByRole('heading', { name: 'Statement' }).waitFor()
    await shoot(page, 'reports-desktop.png')

    await page.goto(`${BASE}/admin/settings`)
    await page.getByRole('heading', { name: 'Venue settings' }).waitFor()
    await shoot(page, 'settings-desktop.png')
    await desktop.context.close()

    const phone = await signedIn(PHONE)
    console.log('phone:')
    await top(phone.page)
    await shoot(phone.page, 'dashboard-phone.png')
    await phone.page.goto(`${BASE}/admin/bookings?status=all&date=${today}`)
    await phone.page.getByRole('button', { name: new RegExp(proofBooking.reference_code) }).click()
    await phone.page.getByRole('button', { name: /Approve/ }).first().waitFor()
    // From the booking's own card (its reference and status), below the phone's sticky header.
    await scrollTo(phone.page.locator('.card', { has: phone.page.getByRole('heading', { name: 'Proof waiting for review' }) }).first(), 72)
    await shoot(phone.page, 'bookings-phone.png')
    await phone.context.close()
  } finally {
    await cleanup()
  }

  const problems = await checkFiles()
  for (const p of problems) console.error(p)
  if (problems.length) process.exitCode = 1
  if (existsSync('../plotline-site')) {
    await mkdir(SITE_OUT, { recursive: true })
    for (const file of await readdir(OUT)) if (FILES.includes(file)) await copyFile(`${OUT}/${file}`, `${SITE_OUT}/${file}`)
    console.log(`Copied ${FILES.length} files to ${SITE_OUT}/`)
  } else {
    console.log('../plotline-site is not checked out: the files were not copied. Copy docs/admin-tour/*.png to public/admin-tour/ there.')
  }
}

await main()
