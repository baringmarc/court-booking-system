// The demo data behind the admin tour pictures (T21.1) and the admin demo video (T21.2): synthetic bookings, a payment
// proof, open play sessions, court illustrations and a ₱10 booking fee on the LOCAL stack, shown with the browser
// clock frozen at 9 AM on the venue's today. `withTourDemo` sets it up, runs the capture, then removes everything,
// restores the venue info and the fee, and checks that nothing is left.
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import {
  addCourtPhotos, anon, at, createAdmin, env, restoreVenueInfo, service, setDemoVenueInfo, snapshotVenueInfo, TZ, venueDate,
} from './local-demo.mjs'

const TAG = 'e2e-tour' // the demo admin is e2e-e2e-tour-admin-…@example.com; guests end in +tour@example.com

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

/** Removes everything this script makes, found by its e2e-tour tag. Returns what was still there afterwards. */
async function purge(made) {
  const { data: leftovers } = await service.from('bookings').select('id').like('guest_email', '%+tour@example.com').throwOnError()
  const ids = [...new Set([...(leftovers ?? []).map((b) => b.id), ...made.bookingIds])]
  await service.from('email_outbox').delete().like('to_email', '%+tour@example.com').throwOnError() // emails queued by an approval or a move
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
  const { count: emails } = await service.from('email_outbox').select('id', { count: 'exact', head: true }).like('to_email', '%+tour@example.com').throwOnError()
  if (emails) found.push(`${emails} queued emails`)
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

/**
 * Runs `run` with the demo data in place. `extras` adds tomorrow's bookings for the video: a second payment proof and a
 * confirmed booking to move (real future times, because the server refuses to review or move what has already passed).
 */
export async function withTourDemo({ port, extras = false }, run) {
  const BASE = `http://127.0.0.1:${port}`
  process.env.VITE_SUPABASE_URL = env.API_URL
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = env.PUBLISHABLE_KEY
  const server = await createServer({ server: { port, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' })
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

    /** A generated GCash receipt as the booking's payment proof, waiting for a review. */
    async function addProof(row, submittedAt) {
      const reference = `GC-${row.reference_code.slice(3)}`
      await helper.setViewportSize({ width: 420, height: 580 })
      await helper.setContent(receiptHtml(row.amount_due, reference))
      const proof = await helper.screenshot({ type: 'png' })
      const { error } = await service.storage.from('payment-proofs').upload(`${row.id}/proof.png`, proof, { contentType: 'image/png' })
      if (error) throw error
      await service.from('payments').insert({
        booking_id: row.id, method: 'gcash', amount: row.amount_due, reference_number: reference,
        storage_path: `${row.id}/proof.png`, review_status: 'pending', submitted_at: submittedAt,
      }).throwOnError()
      await service.from('bookings').update({ status: 'payment_submitted' }).eq('id', row.id).throwOnError()
    }

    // Today: two confirmed bookings (the earlier is the "next booking") and one payment proof waiting for a review.
    const firstBooking = await book('Pickleball 1', today, first, 2, 'Ana Santos', 'confirmed')
    await book('Badminton 2', today, first + 1, 1, 'Ben Reyes', 'confirmed')
    await book('Tennis Court', today, first + 2, 2, 'Carla Dizon', 'confirmed')
    const proofBooking = await book('Badminton 3', today, first + 1, 2, 'Diego Cruz', null)
    await addProof(proofBooking, at(today, 8))

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

    const extra = {}
    if (extras) {
      const tomorrow = venueDate(1)
      extra.proof = await book('Badminton 4', tomorrow, 9, 2, 'Mia Villanueva', null)
      await addProof(extra.proof, at(today, 8))
      extra.move = await book('Pickleball 2', tomorrow, 15, 1, 'Paolo Garcia', 'confirmed')
    }

    /** A browser context showing the venue's today at 9 AM, in light mode. `options` adds to it (a saved session, video). */
    async function newContext(device, options = {}) {
      const context = await browser.newContext({ ...device, timezoneId: TZ, colorScheme: 'light', reducedMotion: 'reduce', ...options })
      await context.clock.setFixedTime(new Date(at(today, NOW_HOUR)))
      return context
    }
    async function signedIn(device) {
      const context = await newContext(device)
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

    await run({ BASE, admin, today, firstBooking, proofBooking, extra, newContext, signedIn, top, scrollTo })
  } finally {
    await cleanup()
  }
}
