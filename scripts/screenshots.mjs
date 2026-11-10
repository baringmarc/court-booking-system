// README screenshots (T9.12): phone (360px) and desktop PNGs of the main pages, written to docs/screenshots/.
// Run: npm run screenshots. LOCAL stack only (`npx supabase start`); it starts its own Vite dev server.
// For the run it adds demo data: generated court illustrations (never third-party photos), venue info, an open
// play session and a guest booking. Afterwards it removes all of it and puts the venue info back as it was.
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { anon, at, addCourtPhotos, createAdmin, env, restoreVenueInfo, service, setDemoVenueInfo, snapshotVenueInfo, TZ, venueDate } from './lib/local-demo.mjs'

const OUT = 'docs/screenshots'
const PORT = 5188
const BASE = `http://127.0.0.1:${PORT}`

// --- Shots ----------------------------------------------------------------------------------------------------

const VIEWPORTS = {
  phone: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 },
}

async function shoot(page, name, kind, { fullPage = false } = {}) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.screenshot({ path: `${OUT}/${name}-${kind}.png`, fullPage })
  console.log(`  ${name}-${kind}.png`)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  // Point the app at the LOCAL stack, as playwright.config.ts does: .env holds the linked (production) project.
  process.env.VITE_SUPABASE_URL = env.API_URL
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = env.PUBLISHABLE_KEY
  const server = await createServer({ server: { port: PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' })
  await server.listen()
  // Software GL: the embedded Google map draws nothing in headless Chromium without it.
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const venueInfo = await snapshotVenueInfo()
  const helper = await browser.newPage()
  const made = { photos: [], admin: null, sessionId: null, bookingId: null, moveBookingId: null }
  let cleaned = false

  // Each step on its own, so one failure can't skip the rest; failures are logged, never swallowed.
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
    if (made.bookingId) await step('demo booking', () => service.from('bookings').delete().eq('id', made.bookingId).throwOnError())
    if (made.moveBookingId) await step('demo booking to reschedule', () => service.from('bookings').delete().eq('id', made.moveBookingId).throwOnError())
    if (made.sessionId) await step('open play session', () => service.from('open_play_sessions').delete().eq('id', made.sessionId).throwOnError())
    if (made.photos.length) {
      await step('court photo rows', () => service.from('court_photos').delete().in('id', made.photos.map((p) => p.id)).throwOnError())
      await step('court photo files', async () => {
        const { error } = await service.storage.from('venue-media').remove(made.photos.map((p) => p.path))
        if (error) throw error
      })
    }
    await step('venue info', () => restoreVenueInfo(venueInfo))
    if (made.admin) await step('admin user', async () => {
      const { error } = await service.auth.admin.deleteUser(made.admin.id)
      if (error) throw error
    })
    await step('browser', () => browser.close())
    await step('dev server', () => server.close())
  }
  // Ctrl-C (for example during the map waits) still removes the demo data.
  process.once('SIGINT', () => {
    console.error('Interrupted: removing the demo data…')
    cleanup().finally(() => process.exit(130))
  })

  try {
    made.photos = await addCourtPhotos(helper)
    await setDemoVenueInfo()
    const admin = await createAdmin()
    made.admin = admin
    const adminClient = anon()
    await adminClient.auth.signInWithPassword({ email: admin.email, password: admin.password })

    // An open play session on the pickleball courts, three days ahead, 10 AM–12 PM.
    const day = venueDate(3)
    const { data: pickleball } = await service.from('courts').select('id').eq('sport', 'pickleball').eq('is_active', true).throwOnError()
    const { data: session, error: sessionError } = await adminClient.rpc('create_open_play', {
      p_court_ids: pickleball.map((c) => c.id), p_start: at(day, 10), p_end: at(day, 12), p_title: 'Open play: all levels',
      p_details: 'All levels welcome. ₱150 per head, paid at the counter.\nPaddles available to borrow.',
      p_links: [{ label: 'RSVP form', url: 'https://forms.gle/claudex-open-play' }, { label: 'Reclub', url: 'https://reclub.co/m/claudex' }],
    })
    if (sessionError) throw sessionError
    made.sessionId = session

    // A guest booking later that day, for the booking page.
    const { data: booked, error: bookingError } = await anon().rpc('create_booking', {
      p_court_id: pickleball[0].id, p_start: at(day, 17), p_slots: 2,
      p_guest_name: 'Ana Santos', p_guest_email: `e2e-screens-guest-${Date.now()}@example.com`, p_guest_phone: '0917 555 0123',
    })
    if (bookingError) throw bookingError
    made.bookingId = booked[0].id

    // A confirmed booking earlier that day, for the reschedule form (staff can only move confirmed bookings).
    const { data: toMove, error: moveError } = await anon().rpc('create_booking', {
      p_court_id: pickleball[1].id, p_start: at(day, 9), p_slots: 1,
      p_guest_name: 'Ben Reyes', p_guest_email: `e2e-screens-move-${Date.now()}@example.com`, p_guest_phone: '0917 555 0456',
    })
    if (moveError) throw moveError
    made.moveBookingId = toMove[0].id
    await service.from('bookings').update({ status: 'confirmed' }).eq('id', toMove[0].id).throwOnError()

    for (const [kind, device] of Object.entries(VIEWPORTS)) {
      console.log(`${kind}:`)
      const player = await browser.newContext({ ...device, timezoneId: TZ, colorScheme: 'light' })
      const page = await player.newPage()
      await page.goto(`${BASE}/`)
      await page.getByRole('heading', { level: 1 }).waitFor()
      await page.evaluate(() => window.scrollTo(0, 0))
      await shoot(page, 'home', kind, { fullPage: kind === 'desktop' })

      await page.goto(`${BASE}/book?date=${day}&sport=pickleball`)
      const slot = page.getByRole('button', { name: /^Pickleball 1 and Pickleball 2, 10 AM – 12 PM, Open play/ })
      await slot.waitFor()
      // The grid, not the controls above it: the legend at the top of the shot.
      await page.locator('.slot-legend').evaluate((el) => el.scrollIntoView({ block: 'start' }))
      await shoot(page, 'book', kind)
      await slot.click()
      await page.getByRole('dialog').waitFor()
      await shoot(page, 'open-play-details', kind)
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: /^Pickleball 2, 1 PM – 2 PM, ₱/ }).click()
      await page.getByRole('button', { name: /^Pickleball 2, 2 PM – 3 PM, ₱/ }).click()
      await page.getByRole('button', { name: 'Continue' }).click()
      await page.getByRole('heading', { name: 'Checkout' }).waitFor()
      await shoot(page, 'checkout', kind)

      await page.goto(`${BASE}/booking/${booked[0].reference_code}#token=${booked[0].guest_token}`)
      await page.getByText(booked[0].reference_code).first().waitFor()
      await shoot(page, 'booking', kind)
      await player.close()

      const staff = await browser.newContext({ ...device, timezoneId: TZ, colorScheme: 'light' })
      const adminPage = await staff.newPage()
      await adminPage.goto(`${BASE}/admin/login`)
      await adminPage.getByLabel('Email').fill(admin.email)
      await adminPage.getByLabel('Password').fill(admin.password)
      await adminPage.getByRole('button', { name: 'Log in' }).click()
      // On a phone the sidebar is a drawer (T17.3), so the dashboard heading is what shows the login worked.
      await adminPage.getByRole('heading', { name: "Today's courts" }).waitFor()
      await shoot(adminPage, 'admin-dashboard', kind)
      // Earnings (T10.7) with the split-bar booked hours (T11.5), from the section's heading down.
      // "This month", so the demo bookings later in the month fill the bars.
      const earnings = adminPage.getByRole('region', { name: 'Earnings' })
      await earnings.getByRole('button', { name: 'This month' }).click()
      await earnings.getByRole('list', { name: 'Collected per day' }).waitFor()
      const hoursHeading = kind === 'phone' ? earnings.getByRole('heading', { name: 'Booked hours' }) : earnings
      await hoursHeading.evaluate((el) => el.scrollIntoView({ block: 'start' }))
      await shoot(adminPage, 'admin-earnings', kind)
      await adminPage.goto(`${BASE}/admin/bookings?status=all&date=${day}`)
      await adminPage.getByRole('button', { name: new RegExp(toMove[0].reference_code) }).click()
      await adminPage.getByRole('button', { name: 'Reschedule' }).click()
      const form = adminPage.getByRole('form', { name: 'Reschedule booking' })
      await form.getByRole('button', { name: 'Tomorrow' }).click()
      await form.getByLabel('New court').selectOption({ label: 'Pickleball 1' })
      await form.getByRole('group', { name: 'New start' }).locator('label').first().click()
      await form.getByLabel('Reason for moving').fill('Rain: the court is wet')
      // On a phone the form is taller than the screen: end on the reason, the summary and the buttons.
      await form.evaluate((el, end) => el.scrollIntoView({ block: end ? 'end' : 'start' }), kind === 'phone')
      await shoot(adminPage, 'admin-reschedule', kind)
      await adminPage.goto(`${BASE}/admin/open-play`)
      await adminPage.getByText('Open play: all levels').first().waitFor()
      await shoot(adminPage, 'admin-open-play', kind)
      // Amenities moved to the Appearance category page in T17.4.
      await adminPage.goto(`${BASE}/admin/settings/appearance`)
      await adminPage.getByRole('heading', { name: 'Amenities' }).scrollIntoViewIfNeeded()
      await shoot(adminPage, 'admin-venue-info', kind)
      await staff.close()
    }
  } finally {
    // Remove every demo record and file, and restore the venue info.
    await cleanup()
  }
}

await main()
