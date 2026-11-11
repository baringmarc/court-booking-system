// Shared by scripts/screenshots.mjs and scripts/admin-tour.mjs: the LOCAL Supabase stack's keys (refusing anything
// else), venue-date helpers, generated court illustrations, and the demo venue info and admin used for captures.
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export const TZ = 'Asia/Manila'

// Keys come from the running local stack, so nothing key-shaped lives in the repo.
export const env = Object.fromEntries(
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
export const service = createClient(env.API_URL, env.SECRET_KEY, { auth: { persistSession: false } })
export const anon = () => createClient(env.API_URL, env.PUBLISHABLE_KEY, { auth: { persistSession: false } })

/** A venue-local date n days ahead ("YYYY-MM-DD"). */
export function venueDate(days) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + days * 86_400_000))
}
export const at = (date, hour) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+08:00`).toISOString()

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

export async function addCourtPhotos(page) {
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

export async function snapshotVenueInfo() {
  const { data: settings } = await service.from('venue_settings').select('venue_id, address, maps_url').single().throwOnError()
  const { data: socials } = await service.from('venue_social_links').select('venue_id, platform, url').throwOnError()
  const { data: amenities } = await service.from('venue_amenities').select('id, venue_id, builtin_key, custom_name, created_at').throwOnError()
  return { settings, socials, amenities }
}

export async function restoreVenueInfo({ settings, socials, amenities }) {
  await service.from('venue_settings').update(settings).eq('venue_id', settings.venue_id).throwOnError()
  await service.from('venue_social_links').delete().not('url', 'is', null).throwOnError()
  if (socials.length) await service.from('venue_social_links').insert(socials).throwOnError()
  await service.from('venue_amenities').delete().not('id', 'is', null).throwOnError()
  if (amenities.length) await service.from('venue_amenities').insert(amenities).throwOnError()
}

export async function setDemoVenueInfo() {
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
export async function createAdmin(tag = 'screens', fullName = 'Marc Admin') {
  const email = `e2e-${tag}-${Date.now()}@example.com`
  const password = 'e2e-password-123'
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  await service.from('profiles').update({ full_name: fullName }).eq('id', data.user.id).throwOnError()
  // Admin rights come from venue membership since M12 (T12.10); Claudex Courts is the only venue.
  const { data: venue } = await service.from('venues').select('id').eq('slug', 'claudex-courts').single().throwOnError()
  await service.from('venue_members').insert({ venue_id: venue.id, user_id: data.user.id, role: 'staff' }).throwOnError()
  return { id: data.user.id, email, password }
}

