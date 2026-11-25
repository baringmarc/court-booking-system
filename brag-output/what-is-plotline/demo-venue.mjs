// Dinkhaus Pickleball, a fictional venue, on the LOCAL stack only, for the video's recording (record.mjs).
// `createVenue` makes it the way the console does (create_venue as a platform admin), as a draft with courts, rates and
// hours but no payment account, so the setup checklist has items left. `finishVenue` adds the payment account and
// instructions, publishes it and adds the demo bookings. `removeVenue` deletes every row and file it made, restores the
// platform booking fee and checks that nothing is left. Run from the repo root (local-demo.mjs reads the local keys).
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { anon, at, env, service, venueDate } from '../../scripts/lib/local-demo.mjs'

export const SLUG = 'dinkhaus'
export const NAME = 'Dinkhaus Pickleball'
const USER_TAG = 'e2e-dinkhaus-' // e2e-… so the e2e teardown would also catch a crashed run
const GUEST_TAG = '+dinkhaus@example.com'
const PASSWORD = 'e2e-password-123'
const here = new URL('.', import.meta.url).pathname
const STATE = `${here}rec/state.json` // the booking fee before the run, kept on disk so a crashed run can restore it

// Every public table with a venue_id, children first. A pass that hits a foreign key is retried after the others.
const VENUE_TABLES = ['email_outbox', 'billing_charges', 'booking_changes', 'guest_link_tokens', 'refunds', 'paymongo_checkouts',
  'payments', 'bookings', 'open_play_courts', 'open_play_sessions', 'live_stacks', 'invoices', 'court_photos', 'court_promo_courts',
  'court_promos', 'court_rates', 'court_open_periods', 'court_schedule_modes', 'blackouts', 'courts', 'venue_amenities',
  'venue_info_sections', 'venue_social_links', 'venue_payment_accounts', 'venue_open_periods', 'operating_hours',
  'venue_schedule_state', 'venue_members', 'venue_settings']

const svgFile = (name) => readFile(`${here}${name}`, 'utf8')

/** Draws HTML in the helper page and returns a PNG of the given size. */
async function png(page, html, width, height) {
  await page.setViewportSize({ width, height })
  await page.setContent(`<body style="margin:0">${html}</body>`)
  await page.evaluate(() => document.fonts.ready)
  return page.screenshot({ type: 'png', omitBackground: false })
}

/** A pickleball court seen from a raised corner; variant 1 is the evening view. The court's index tints it a little. */
function courtSvg(variant, index) {
  const floor = ['#2d6fa3', '#2f7a8f', '#3a6ea5'][index % 3]
  const sky = variant === 1 ? ['#1d2440', '#3b3f6b'] : ['#cfe3f2', '#f3efe6']
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient>
    <radialGradient id="light" cx="0.5" cy="0.35" r="0.7"><stop offset="0" stop-color="#fff" stop-opacity="${variant === 1 ? 0.35 : 0.18}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#sky)"/>
  <rect y="300" width="1600" height="600" fill="#14341e"/>
  <polygon points="420,330 1180,330 1520,860 80,860" fill="${floor}"/>
  <g fill="none" stroke="#fff" stroke-width="7" stroke-linejoin="round">
    <polygon points="440,345 1160,345 1480,840 120,840"/>
    <line x1="290" y1="590" x2="1310" y2="590"/>
    <line x1="800" y1="345" x2="800" y2="500"/><line x1="800" y1="680" x2="800" y2="840"/>
    <line x1="350" y1="500" x2="1250" y2="500"/><line x1="235" y1="680" x2="1365" y2="680"/>
  </g>
  <g stroke="#e8e8e8" stroke-width="5"><line x1="270" y1="590" x2="270" y2="500"/><line x1="1330" y1="590" x2="1330" y2="500"/></g>
  <rect x="270" y="510" width="1060" height="70" fill="#ffffff" fill-opacity="0.22" stroke="#f2f2f2" stroke-width="3"/>
  <rect width="1600" height="900" fill="url(#light)"/>
</svg>`
}

/** A QR-like pattern that encodes nothing: it looks like a payment QR but can't be scanned or paid. */
function fakeQrHtml() {
  const n = 29, cell = 14, quiet = 4
  let seed = 7
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const finder = (x, y) => (r, c) => {
    const dr = r - y, dc = c - x
    if (dr < 0 || dc < 0 || dr > 6 || dc > 6) return null
    const ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3))
    return ring === 3 || ring <= 1
  }
  const finders = [finder(0, 0), finder(n - 7, 0), finder(0, n - 7)]
  let rects = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const f = finders.map((fn) => fn(r, c)).find((v) => v !== null)
    const nearFinder = (r < 8 && (c < 8 || c > n - 9)) || (r > n - 9 && c < 8)
    const on = f ?? (nearFinder ? false : rand() > 0.52)
    if (on) rects += `<rect x="${(c + quiet) * cell}" y="${(r + quiet) * cell}" width="${cell}" height="${cell}"/>`
  }
  const size = (n + quiet * 2) * cell
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="#fff"/><g fill="#1d1916">${rects}</g></svg>`
}

/** A plain transfer receipt (no wallet's branding), clearly an example. */
export const receiptHtml = (amount, ref, when) => `
<div style="width:540px;height:900px;box-sizing:border-box;padding:56px 48px;background:#fff;font-family:Helvetica,Arial,sans-serif;color:#1d2433;position:relative">
  <div style="font-size:22px;color:#5b6577;letter-spacing:.04em;text-transform:uppercase">Transfer receipt</div>
  <div style="margin-top:18px;font-size:20px;color:#5b6577">Amount sent</div>
  <div style="font-size:64px;font-weight:700;margin:6px 0 30px">₱${Number(amount).toLocaleString('en-PH')}.00</div>
  <div style="border-top:2px solid #e3e7ee;padding-top:24px;font-size:20px;line-height:2.1;color:#5b6577">
    Sent to<br><b style="color:#1d2433;font-size:24px">DINKHAUS PICKLEBALL</b><br>
    Account<br><b style="color:#1d2433;font-size:24px">0917 555 0188</b><br>
    Reference no.<br><b style="color:#1d2433;font-size:24px">${ref}</b><br>
    Date<br><b style="color:#1d2433;font-size:24px">${when}</b><br>
    Status<br><b style="color:#1a8a4a;font-size:24px">Successful</b>
  </div>
  <div style="position:absolute;left:0;right:0;bottom:44px;text-align:center;font-size:18px;color:#9aa3b2">Example receipt for a demo</div>
</div>`

async function deleteUsers() {
  const { data } = await service.auth.admin.listUsers({ perPage: 1000 })
  for (const user of (data?.users ?? []).filter((u) => u.email?.startsWith(USER_TAG))) {
    await service.from('platform_admins').delete().eq('user_id', user.id)
    const { error } = await service.auth.admin.deleteUser(user.id)
    if (error) throw error
  }
}

async function makeUser(kind, fullName) {
  const email = `${USER_TAG}${kind}-${Date.now()}@example.com`
  const { data, error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error) throw error
  await service.from('profiles').update({ full_name: fullName }).eq('id', data.user.id).throwOnError()
  return { id: data.user.id, email, password: PASSWORD }
}

async function removeFolder(bucket, folder) {
  const { data, error } = await service.storage.from(bucket).list(folder, { limit: 1000 })
  if (error) throw error
  const files = (data ?? []).filter((f) => f.id).map((f) => `${folder}/${f.name}`)
  for (const sub of (data ?? []).filter((f) => !f.id)) await removeFolder(bucket, `${folder}/${sub.name}`)
  if (files.length) {
    const { error: removeError } = await service.storage.from(bucket).remove(files)
    if (removeError) throw removeError
  }
}

async function listCount(bucket, folder) {
  const { data } = await service.storage.from(bucket).list(folder, { limit: 1000 })
  return (data ?? []).length
}

/** Deletes Dinkhaus and everything it owns, puts the booking fee back, and returns what is still there (empty: clean). */
export async function removeVenue() {
  const { data: venue } = await service.from('venues').select('id').eq('slug', SLUG).maybeSingle().throwOnError()
  if (venue) {
    const id = venue.id
    const { data: bookings } = await service.from('bookings').select('id').eq('venue_id', id).throwOnError()
    const bookingIds = (bookings ?? []).map((b) => b.id)
    for (let pass = 0; pass < 4; pass++) {
      let failed = 0
      for (const table of VENUE_TABLES) {
        const { error } = await service.from(table).delete().eq('venue_id', id)
        if (error) failed++
        if (error && pass === 3) console.error(`delete ${table}: ${error.message}`)
      }
      const { error } = await service.from('venues').delete().eq('id', id)
      if (!error && !failed) break
      if (error && pass === 3) console.error(`delete venues: ${error.message}`)
    }
    for (const bookingId of bookingIds) await removeFolder('payment-proofs', bookingId)
    await removeFolder('venue-media', id)
    await removeFolder('payment-qr', id)
    await service.from('email_outbox').delete().like('to_email', `%${GUEST_TAG}`)
  }
  await deleteUsers()
  if (existsSync(STATE)) {
    const { bookingFee } = JSON.parse(await readFile(STATE, 'utf8'))
    await service.from('platform_pricing').update({ booking_fee: bookingFee }).eq('id', true).throwOnError()
  }
  return leftovers(venue?.id)
}

async function leftovers(id) {
  const found = []
  const { count: venues } = await service.from('venues').select('id', { count: 'exact', head: true }).eq('slug', SLUG)
  if (venues) found.push('the venue row')
  if (id) {
    for (const table of VENUE_TABLES) {
      const { count, error } = await service.from(table).select('*', { count: 'exact', head: true }).eq('venue_id', id)
      if (error) found.push(`${table}: ${error.message}`)
      else if (count) found.push(`${count} ${table} rows`)
    }
    for (const bucket of ['venue-media', 'payment-qr']) if (await listCount(bucket, id)) found.push(`files in ${bucket}/${id}`)
  }
  const { count: emails } = await service.from('email_outbox').select('id', { count: 'exact', head: true }).like('to_email', `%${GUEST_TAG}`)
  if (emails) found.push(`${emails} queued emails`)
  const { data: users } = await service.auth.admin.listUsers({ perPage: 1000 })
  const stray = (users?.users ?? []).filter((u) => u.email?.startsWith(USER_TAG)).length
  if (stray) found.push(`${stray} tagged users`)
  if (existsSync(STATE)) {
    const { bookingFee } = JSON.parse(await readFile(STATE, 'utf8'))
    const { data: pricing } = await service.from('platform_pricing').select('booking_fee').eq('id', true).single().throwOnError()
    if (Number(pricing.booking_fee) !== Number(bookingFee)) found.push(`the booking fee (${pricing.booking_fee}, was ${bookingFee})`)
  }
  return found
}

/** Step 1: the venue as the console leaves it before the owner finishes setup (a draft, no payment account yet). */
export async function createVenue(helper) {
  const left = await removeVenue() // a crashed earlier run
  if (left.length) throw new Error(`An earlier Dinkhaus is still there: ${left.join(', ')}`)
  const { data: pricing } = await service.from('platform_pricing').select('booking_fee').eq('id', true).single().throwOnError()
  await writeFile(STATE, JSON.stringify({ bookingFee: pricing.booking_fee }))

  const platform = await makeUser('platform', 'Plotline Staff')
  await service.from('platform_admins').insert({ user_id: platform.id }).throwOnError()
  const console_ = createClient(env.API_URL, env.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const signIn = await console_.auth.signInWithPassword({ email: platform.email, password: platform.password })
  if (signIn.error) throw signIn.error
  const { data: venueId, error } = await console_.rpc('create_venue', { p_slug: SLUG, p_name: NAME, p_timezone: 'Asia/Manila' })
  if (error) throw error

  const owner = await makeUser('owner', 'Rina Dizon')
  await service.from('venue_members').insert({ venue_id: venueId, user_id: owner.id, role: 'owner' }).throwOnError()

  const logo = await png(helper, await svgFile('logo.svg').then((svg) => svg.replace('<svg ', '<svg width="512" height="512" ')), 512, 512)
  const logoPath = `${venueId}/logo/${randomUUID()}.png`
  const up = await service.storage.from('venue-media').upload(logoPath, logo, { contentType: 'image/png', cacheControl: '31536000' })
  if (up.error) throw up.error

  await service.from('venue_settings').update({
    city: 'Pasig', address: '88 Sampaguita St, Pasig City', maps_url: 'https://www.google.com/maps/search/?api=1&query=Pasig%20City',
    theme: 'court-green', logo_path: logoPath,
  }).eq('venue_id', venueId).throwOnError()
  await service.from('courts').insert([1, 2, 3].map((n) => ({
    venue_id: venueId, name: `Court ${n}`, sport: 'pickleball', default_hourly_rate: 400, sort_order: n - 1,
  }))).throwOnError()
  // Court photos: a drawn pickleball court (day and evening), as the admin tour's demo data does for Claudex.
  const { data: courtRows } = await service.from('courts').select('id, sort_order').eq('venue_id', venueId).throwOnError()
  for (const c of courtRows) {
    for (const variant of [0, 1]) {
      const image = await png(helper, courtSvg(variant, c.sort_order), 1600, 900)
      const path = `${venueId}/courts/${c.id}/${randomUUID()}.png`
      const upload = await service.storage.from('venue-media').upload(path, image, { contentType: 'image/png', cacheControl: '31536000' })
      if (upload.error) throw upload.error
      await service.from('court_photos').insert({ venue_id: venueId, court_id: c.id, path, sort_order: variant }).throwOnError()
    }
  }
  await service.from('venue_amenities').insert(['restrooms', 'parking', 'water_station', 'night_lights', 'equipment_rental']
    .map((builtin_key) => ({ venue_id: venueId, builtin_key }))).throwOnError()
  return { venueId, owner }
}

/** Step 2: the payment account and instructions, published, with a ₱10 booking fee and the demo bookings. */
export async function finishVenue(helper, venueId) {
  const qr = await png(helper, fakeQrHtml(), 518, 518)
  const qrPath = `${venueId}/${randomUUID()}.png`
  const up = await service.storage.from('payment-qr').upload(qrPath, qr, { contentType: 'image/png', cacheControl: '31536000' })
  if (up.error) throw up.error
  await service.from('venue_payment_accounts').insert({
    venue_id: venueId, label: 'GCash', account_name: 'Dinkhaus Pickleball', account_number: '0917 555 0188', qr_path: qrPath,
  }).throwOnError()
  await service.from('venue_settings').update({
    payment_instructions: 'Scan our QR code, pay the total, then upload a screenshot of your receipt here.',
  }).eq('venue_id', venueId).throwOnError()
  await service.from('venues').update({ status: 'active' }).eq('id', venueId).throwOnError()
  // Walk-ins on: the video shows them as part of every venue (the user's plan, 2026-11-25; today they are off by
  // default and Plotline switches them on per venue). Only the service role or set_walk_ins may change the flag.
  await service.from('venue_settings').update({ walk_ins_enabled: true }).eq('venue_id', venueId).throwOnError()
  await service.from('platform_pricing').update({ booking_fee: 10 }).eq('id', true).throwOnError()

  const { data: courts } = await service.from('courts').select('id, name').eq('venue_id', venueId).throwOnError()
  const court = (name) => courts.find((c) => c.name === name).id
  let lane = 0, phone = 10
  const guest = (name) => ({
    p_guest_name: name, p_guest_email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}${GUEST_TAG}`, p_guest_phone: `0917 555 01${phone++}`,
  })
  /**
   * create_booking (it refuses the past, and prices the booking) at 6 AM three days ahead, a time nothing else uses,
   * then moved to its real day and hour. Each booking leaves that time before the next one is made.
   */
  async function book(courtName, day, hour, slots, name, status, method = 'gcash') {
    const spare = lane++
    const { data, error } = await anon().rpc('create_booking', {
      p_court_id: court(courtName), p_start: at(venueDate(3), 6), p_slots: slots, p_waiver_accepted: true, ...guest(name),
    })
    if (error) throw error
    const row = data[0]
    const start = at(day, hour)
    const end = new Date(new Date(start).getTime() + slots * 3_600_000).toISOString()
    await service.from('bookings').update({ during: `[${start},${end})` }).eq('id', row.id).throwOnError()
    const { data: priced } = await service.from('bookings').select('amount_due').eq('id', row.id).single().throwOnError()
    if (status === 'confirmed') {
      const paidAt = at(day, Math.max(6, hour - 2))
      await service.from('payments').insert({
        booking_id: row.id, method, amount: priced.amount_due, reference_number: `${row.reference_code.slice(3)}-${spare}`,
        review_status: 'approved', submitted_at: paidAt, reviewed_at: paidAt,
      }).throwOnError()
      await service.from('bookings').update({ status: 'confirmed' }).eq('id', row.id).throwOnError()
    }
    return { ...row, amount_due: priced.amount_due }
  }
  /** A receipt waiting for review, as the payment proof Edge Function leaves it. */
  async function addProof(row, submittedAt, ref) {
    const image = await png(helper, receiptHtml(row.amount_due, ref, 'Today'), 540, 900)
    const path = `${row.id}/${randomUUID()}.png`
    const { error } = await service.storage.from('payment-proofs').upload(path, image, { contentType: 'image/png' })
    if (error) throw error
    await service.from('payments').insert({
      booking_id: row.id, method: 'gcash', amount: row.amount_due, reference_number: ref, storage_path: path,
      review_status: 'pending', submitted_at: submittedAt,
    }).throwOnError()
    await service.from('bookings').update({ status: 'payment_submitted' }).eq('id', row.id).throwOnError()
  }

  // Today, from the next free hour on, so the bookings are still ahead whenever this runs.
  const today = venueDate(0)
  const hourNow = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  const t0 = Math.min(Math.max(hourNow + 1, 10), 17)
  await book('Court 1', today, t0, 2, 'Ana Santos', 'confirmed')
  await book('Court 2', today, t0 + 1, 1, 'Ben Reyes', 'confirmed')
  await book('Court 3', today, t0 + 2, 2, 'Liza Mendoza', 'confirmed')
  await book('Court 1', today, t0 + 3, 2, 'Joel Ramos', 'confirmed')
  await book('Court 2', today, t0 + 4, 2, 'Trish Uy', 'confirmed')

  // Tomorrow: the evening the player books into (Court 2 at 7 PM is taken) and a proof waiting for review.
  const tomorrow = venueDate(1)
  await book('Court 2', tomorrow, 19, 2, 'Marco Lim', 'confirmed')
  await book('Court 3', tomorrow, 18, 2, 'Bea Navarro', 'confirmed')
  await book('Court 1', tomorrow, 17, 1, 'Ivan Cruz', 'confirmed')
  const waiting = await book('Court 3', tomorrow, 9, 2, 'Mia Villanueva', null)
  await addProof(waiting, new Date(Date.now() - 40 * 60_000).toISOString(), '7301 552 019')
  // Two confirmed bookings to move in the video (one per admin take).
  const toMove = [
    await book('Court 1', tomorrow, 15, 1, 'Paolo Garcia', 'confirmed'),
    await book('Court 1', tomorrow, 13, 1, 'Paolo Garcia', 'confirmed'),
  ]

  // Earlier this month: paid bookings for the earnings.
  const names = ['Ella Tan', 'Felix Ramos', 'Gina Lopez', 'Hugo Bautista', 'Ines Garcia', 'Jun Mercado', 'Kara Reyes', 'Leo Aquino', 'Nina Santos', 'Oscar Lee']
  const methods = ['gcash', 'gcash', 'maya', 'gcash', 'bank_transfer']
  let k = 0
  for (let d = 1; d <= 24; d++) {
    const day = venueDate(-d)
    if (day.slice(0, 7) !== today.slice(0, 7)) break
    const spots = [['Court 1', 18, 2], ['Court 2', 19, 2], ['Court 3', 7, 1], ['Court 1', 20, 1], ['Court 2', 17, 1]]
    for (let j = 0; j < 2 + (d % 3); j++) {
      const [courtName, hour, slots] = spots[(d + j) % spots.length]
      await book(courtName, day, hour, slots, names[k % names.length], 'confirmed', methods[k % methods.length])
      k++
    }
  }
  return { today, tomorrow, waiting, toMove }
}

/** Re-runs of the admin take need the player's booking under review again: a fresh booking, same court, time and receipt. */
export async function rebookPlayer(helper, venueId, { name, email, phone, courtName, day, hour, slots, receipt }, { replace = false } = {}) {
  if (replace) {
    // The earlier, already approved booking holds the same court and time: remove it and what hangs off it.
    const { data: old } = await service.from('bookings').select('id').eq('venue_id', venueId).eq('guest_email', email).throwOnError()
    const ids = (old ?? []).map((b) => b.id)
    if (ids.length) {
      for (const table of ['email_outbox', 'billing_charges', 'booking_changes', 'guest_link_tokens', 'refunds', 'paymongo_checkouts', 'payments']) {
        await service.from(table).delete().in('booking_id', ids)
      }
      await service.from('bookings').delete().in('id', ids).throwOnError()
      for (const id of ids) await removeFolder('payment-proofs', id)
    }
  }
  const { data: courts } = await service.from('courts').select('id, name').eq('venue_id', venueId).throwOnError()
  const { data, error } = await anon().rpc('create_booking', {
    p_court_id: courts.find((c) => c.name === courtName).id, p_start: at(day, hour), p_slots: slots,
    p_guest_name: name, p_guest_email: email, p_guest_phone: phone, p_waiver_accepted: true,
  })
  if (error) throw error
  const row = data[0]
  const { data: priced } = await service.from('bookings').select('amount_due').eq('id', row.id).single().throwOnError()
  const path = `${row.id}/${randomUUID()}.png`
  const up = await service.storage.from('payment-proofs').upload(path, receipt, { contentType: 'image/png' })
  if (up.error) throw up.error
  await service.from('payments').insert({
    booking_id: row.id, method: 'gcash', amount: priced.amount_due, reference_number: null, storage_path: path,
    review_status: 'pending', submitted_at: new Date().toISOString(),
  }).throwOnError()
  await service.from('bookings').update({ status: 'payment_submitted' }).eq('id', row.id).throwOnError()
  return row
}

export { GUEST_TAG }
