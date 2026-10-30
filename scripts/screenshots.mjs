// README screenshots (T9.12): phone (360px) and desktop PNGs of the main pages, written to docs/screenshots/.
// Run: npm run screenshots. LOCAL stack only (`npx supabase start`); it starts its own Vite dev server.
// For the run it adds demo data: generated court illustrations (never third-party photos), venue info, an open
// play session and a guest booking. Afterwards it removes all of it and puts the venue info back as it was.
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { createServer } from 'vite'

const OUT = 'docs/screenshots'
const PORT = 5188
const BASE = `http://127.0.0.1:${PORT}`
const TZ = 'Asia/Manila'

// Keys come from the running local stack, so nothing key-shaped lives in the repo.
const env = Object.fromEntries(
  execSync('sh scripts/with-docker.sh npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n')
    .map((line) => line.match(/^([A-Z_]+)="?([^"]*)"?$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
)
if (!env.API_URL?.startsWith('http://127.0.0.1') || !env.PUBLISHABLE_KEY || !env.SECRET_KEY) {
  console.error('Local Supabase stack not running (or not local). Start it with: npx supabase start')
  process.exit(1)
}
const service = createClient(env.API_URL, env.SECRET_KEY, { auth: { persistSession: false } })
const anon = () => createClient(env.API_URL, env.PUBLISHABLE_KEY, { auth: { persistSession: false } })

/** A venue-local date n days ahead ("YYYY-MM-DD"). */
function venueDate(days) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + days * 86_400_000))
}
const at = (date, hour) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+08:00`).toISOString()

// --- Generated court illustrations ------------------------------------------------------------------------

const PALETTES = {
  badminton: { floor: '#2f7d5b', out: '#1f5c42', line: '#f4f1e8' },
  pickleball: { floor: '#2d6fa3', out: '#7a4f2d', line: '#ffffff' },
  basketball: { floor: '#c98a4b', out: '#a96f39', line: '#fdf6ea' },
  tennis: { floor: '#3a6ea5', out: '#4f8a4a', line: '#ffffff' },
}

/** A stylised court seen from a raised corner, with soft light. Variant 1 is the evening view. */
function courtSvg(sport, variant) {
  const p = PALETTES[sport]
  const sky = variant === 1 ? ['#1d2440', '#3b3f6b'] : ['#cfe3f2', '#f3efe6']
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient>
    <radialGradient id="light" cx="0.5" cy="0.35" r="0.7"><stop offset="0" stop-color="#fff" stop-opacity="${variant === 1 ? 0.35 : 0.18}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#sky)"/>
  <rect y="300" width="1600" height="600" fill="${p.out}"/>
  <polygon points="420,330 1180,330 1520,860 80,860" fill="${p.floor}"/>
  <g fill="none" stroke="${p.line}" stroke-width="7" stroke-linejoin="round">
    <polygon points="440,345 1160,345 1480,840 120,840"/>
    <line x1="290" y1="590" x2="1310" y2="590"/>
    <line x1="800" y1="345" x2="800" y2="840"/>
    <line x1="380" y1="460" x2="1220" y2="460"/>
    <line x1="215" y1="720" x2="1385" y2="720"/>
  </g>
  <g stroke="#e8e8e8" stroke-width="5"><line x1="270" y1="590" x2="270" y2="470"/><line x1="1330" y1="590" x2="1330" y2="470"/></g>
  <rect x="270" y="470" width="1060" height="${sport === 'basketball' ? 0 : 70}" fill="#ffffff" fill-opacity="0.22" stroke="#f2f2f2" stroke-width="3"/>
  <rect width="1600" height="900" fill="url(#light)"/>
</svg>`
}

async function addCourtPhotos(page) {
  const { data: courts } = await service.from('courts').select('id, venue_id, sport, court_photos(id)').eq('is_active', true).throwOnError()
  const added = []
  for (const court of courts.filter((c) => c.court_photos.length === 0)) {
    for (const variant of [0, 1]) {
      await page.setViewportSize({ width: 1600, height: 900 })
      await page.setContent(`<body style="margin:0">${courtSvg(court.sport, variant)}</body>`)
      const png = await page.screenshot({ type: 'png' })
      const path = `${court.venue_id}/courts/${court.id}/${randomUUID()}.png`
      const { error } = await service.storage.from('venue-media').upload(path, png, { contentType: 'image/png' })
      if (error) throw error
      const { data: row } = await service.from('court_photos')
        .insert({ venue_id: court.venue_id, court_id: court.id, path, sort_order: variant }).select('id').single().throwOnError()
      added.push({ id: row.id, path })
    }
  }
  return added
}

// --- Demo data ----------------------------------------------------------------------------------------------

async function snapshotVenueInfo() {
  const { data: settings } = await service.from('venue_settings').select('venue_id, address, maps_url').single().throwOnError()
  const { data: socials } = await service.from('venue_social_links').select('venue_id, platform, url').throwOnError()
  const { data: amenities } = await service.from('venue_amenities').select('id, venue_id, builtin_key, custom_name, created_at').throwOnError()
  return { settings, socials, amenities }
}

async function restoreVenueInfo({ settings, socials, amenities }) {
  await service.from('venue_settings').update(settings).eq('venue_id', settings.venue_id).throwOnError()
  await service.from('venue_social_links').delete().not('url', 'is', null).throwOnError()
  if (socials.length) await service.from('venue_social_links').insert(socials).throwOnError()
  await service.from('venue_amenities').delete().not('id', 'is', null).throwOnError()
  if (amenities.length) await service.from('venue_amenities').insert(amenities).throwOnError()
}

async function setDemoVenueInfo() {
  const { data: venue } = await service.from('venues').select('id').eq('slug', 'claudex-courts').single().throwOnError()
  const venue_id = venue.id
  await service.from('venue_settings')
    .update({ address: '123 Rizal Ave, Makati City', maps_url: 'https://www.google.com/maps/search/?api=1&query=Ayala%20Triangle%20Gardens%2C%20Makati' }).eq('venue_id', venue_id).throwOnError()
  await service.from('venue_social_links').delete().not('url', 'is', null).throwOnError()
  await service.from('venue_social_links').insert([
    { venue_id, platform: 'facebook', url: 'https://www.facebook.com/claudexcourts' },
    { venue_id, platform: 'instagram', url: 'https://www.instagram.com/claudexcourts' },
    { venue_id, platform: 'website', url: 'https://claudex-courts.example.ph' },
  ]).throwOnError()
  await service.from('venue_amenities').delete().not('id', 'is', null).throwOnError()
  await service.from('venue_amenities').insert(
    ['restrooms', 'parking', 'showers', 'water_station', 'night_lights', 'wifi', 'equipment_rental'].map((builtin_key) => ({ venue_id, builtin_key })),
  ).throwOnError()
}

/** A throwaway confirmed admin (e2e-… so the e2e teardown would also catch a crashed run). */
async function createAdmin() {
  const email = `e2e-screens-${Date.now()}@example.com`
  const password = 'e2e-password-123'
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  await service.from('profiles').update({ full_name: 'Marc Admin' }).eq('id', data.user.id).throwOnError()
  // Admin rights come from venue membership since M12 (T12.10); Claudex Courts is the only venue.
  const { data: venue } = await service.from('venues').select('id').eq('slug', 'claudex-courts').single().throwOnError()
  await service.from('venue_members').insert({ venue_id: venue.id, user_id: data.user.id, role: 'staff' }).throwOnError()
  return { id: data.user.id, email, password }
}

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
      await adminPage.getByRole('navigation', { name: 'Admin' }).waitFor()
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
      await adminPage.goto(`${BASE}/admin/settings`)
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
