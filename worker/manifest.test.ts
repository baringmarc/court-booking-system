// @vitest-environment node
// The web manifest per venue (T30.8): pure functions, no Workers globals, so Vitest runs them as they are.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { THEME_PRESETS, THEME_SWATCHES } from '../src/lib/themes'
import {
  PLOTLINE_ICONS,
  THEME_BACKGROUNDS,
  buildVenueManifest,
  logoUrl,
  manifestColors,
  shortName,
  type ManifestIcon,
} from './manifest'
import type { VenueCardData } from './venueCard'

const SUPABASE_URL = 'https://abcdefghijklmnop.supabase.co'
const VENUE_ID = '11111111-1111-4111-8111-111111111111'
const LOGO_WEBP = `${VENUE_ID}/logo/22222222-2222-4222-8222-222222222222.webp`
const LOGO_JPG = `${VENUE_ID}/logo/22222222-2222-4222-8222-222222222222.jpg`
const LOGO_JPEG = `${VENUE_ID}/logo/22222222-2222-4222-8222-222222222222.jpeg`
const LOGO_PNG = `${VENUE_ID}/logo/22222222-2222-4222-8222-222222222222.png`
const UPDATED_AT = '2026-11-20T10:15:30.123+00:00'

const venue: VenueCardData = {
  slug: 'claudex-courts',
  name: 'Claudex Courts',
  city: 'Cebu City',
  bannerPath: null,
  bannerAlt: null,
  logoPath: null,
  sportOrder: ['pickleball', 'badminton'],
  updatedAt: UPDATED_AT,
  theme: 'plotline',
}

const ctx = { supabaseUrl: SUPABASE_URL }

function storageUrl(path: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/venue-media/${path}?v=${encodeURIComponent(UPDATED_AT)}`
}

const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url))

describe('shortName: whole words that fit in 12 characters', () => {
  it('cuts "Claudex Courts" (14) to "Claudex"', () => {
    expect(shortName('Claudex Courts')).toBe('Claudex')
  })

  it('cuts "Big Dink Pickleball" to "Big Dink", keeping every leading word that fits', () => {
    expect(shortName('Big Dink Pickleball')).toBe('Big Dink')
  })

  it('keeps "Smash Arena" (11) whole', () => {
    expect(shortName('Smash Arena')).toBe('Smash Arena')
  })

  it('keeps a name of exactly 12 characters whole', () => {
    expect(shortName('Twelve Chars')).toBe('Twelve Chars')
    expect(shortName('Court Number')).toBe('Court Number')
    expect(shortName('abcdefghijkl')).toBe('abcdefghijkl')
  })

  it('cuts a name of 13 characters to the words that fit', () => {
    expect(shortName('Padel Parkway')).toBe('Padel')
    expect(shortName('Ace Hub Arena')).toBe('Ace Hub')
  })

  it('keeps several words when they total exactly 12', () => {
    expect(shortName('Smash Arenas Club')).toBe('Smash Arenas')
  })

  it('cuts a first word longer than 12 to its first 12 characters', () => {
    expect(shortName('Supercalifragilistic Club')).toBe('Supercalifra')
    expect(shortName('Supercalifragilistic')).toBe('Supercalifra')
    expect(shortName('abcdefghijklm')).toBe('abcdefghijkl')
  })

  it('trims the name and collapses runs of whitespace to one space', () => {
    expect(shortName('  Ace   Hub ')).toBe('Ace Hub')
    expect(shortName('Ace\t Hub\n')).toBe('Ace Hub')
    expect(shortName('  Big   Dink    Pickleball ')).toBe('Big Dink')
  })

  it('never ends in a space or an ellipsis', () => {
    for (const name of ['Claudex Courts', 'Big Dink Pickleball', 'Supercalifragilistic Club', '  Ace   Hub ', 'Ace Hub Arena']) {
      const out = shortName(name)
      expect(out, name).toBe(out.trim())
      expect(out, name).not.toMatch(/…|\.\.\./)
      expect([...out].length, name).toBeLessThanOrEqual(12)
      expect(out.length, name).toBeGreaterThan(0)
    }
  })

  it('counts an emoji as one character and never splits it', () => {
    const racket = '\u{1F3BE}'
    const thirteen = racket.repeat(13)
    expect(shortName(thirteen)).toBe(racket.repeat(12))
    expect(shortName(`${racket.repeat(12)}`)).toBe(racket.repeat(12))
    expect(shortName(`${racket}${racket} Courts Club`)).toBe(`${racket}${racket} Courts`)
  })

  it('counts an accented letter as one character', () => {
    // "Ñandú Padel" is 11 characters; adding " Club" makes 16.
    expect(shortName('Ñandú Padel Club')).toBe('Ñandú Padel')
    expect(shortName('Ñandú Padel')).toBe('Ñandú Padel')
  })
})

describe('THEME_BACKGROUNDS', () => {
  it('lists the light-mode page background of each preset', () => {
    expect(THEME_BACKGROUNDS).toEqual({
      plotline: '#f5efe6',
      'court-green': '#eef6f1',
      ocean: '#eef3f6',
      plum: '#f6eef6',
      sunset: '#f6f2ee',
      slate: '#f1f2f3',
      midnight: '#14151f',
    })
  })

  it('keeps the preset keys equal to THEME_PRESETS in src/lib/themes.ts', () => {
    expect(Object.keys(THEME_BACKGROUNDS).sort()).toEqual([...THEME_PRESETS].sort())
    expect(Object.keys(THEME_BACKGROUNDS).sort()).toEqual(Object.keys(THEME_SWATCHES).sort())
  })

  it('keeps every background equal to THEME_SWATCHES[key].light.bg', () => {
    for (const key of THEME_PRESETS) {
      expect(THEME_BACKGROUNDS[key], key).toBe(THEME_SWATCHES[key].light.bg)
    }
  })
})

describe('manifestColors', () => {
  it('uses the preset page background for both colors, for every preset', () => {
    for (const key of THEME_PRESETS) {
      const bg = THEME_SWATCHES[key].light.bg
      expect(manifestColors(key), key).toEqual({ theme_color: bg, background_color: bg })
    }
  })

  it('gives the Plotline background for an unknown, empty, null or undefined theme', () => {
    const plotline = { theme_color: '#f5efe6', background_color: '#f5efe6' }
    expect(manifestColors('neon')).toEqual(plotline)
    expect(manifestColors('')).toEqual(plotline)
    expect(manifestColors(null)).toEqual(plotline)
    expect(manifestColors(undefined)).toEqual(plotline)
  })

  it('does not treat object prototype keys as presets', () => {
    const plotline = { theme_color: '#f5efe6', background_color: '#f5efe6' }
    expect(manifestColors('constructor')).toEqual(plotline)
    expect(manifestColors('toString')).toEqual(plotline)
    expect(manifestColors('__proto__')).toEqual(plotline)
  })
})

describe('logoUrl', () => {
  it('is null without a logo', () => {
    expect(logoUrl(venue, SUPABASE_URL)).toBeNull()
  })

  it('is the versioned public storage URL of the logo', () => {
    expect(logoUrl({ ...venue, logoPath: LOGO_WEBP }, SUPABASE_URL)).toBe(storageUrl(LOGO_WEBP))
  })

  it('changes when the settings are updated', () => {
    const a = logoUrl({ ...venue, logoPath: LOGO_PNG }, SUPABASE_URL)
    const b = logoUrl({ ...venue, logoPath: LOGO_PNG, updatedAt: '2026-11-21T00:00:00+00:00' }, SUPABASE_URL)
    expect(a).not.toBeNull()
    expect(a).not.toBe(b)
  })
})

describe('PLOTLINE_ICONS', () => {
  it('lists the 192, 512 and maskable 512 icons in that order', () => {
    expect(PLOTLINE_ICONS).toEqual([
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ])
  })

  it('names files under public/ whose real size matches the declared sizes', () => {
    for (const icon of PLOTLINE_ICONS) {
      const path = root(`public${icon.src}`)
      expect(existsSync(path), icon.src).toBe(true)
      const bytes = readFileSync(path)
      expect([...bytes.subarray(0, 8)], icon.src).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      expect(bytes.subarray(12, 16).toString('latin1'), icon.src).toBe('IHDR')
      expect(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.src).toBe(icon.sizes)
    }
  })
})

describe('buildVenueManifest without a logo', () => {
  const manifest = buildVenueManifest(venue, ctx)

  it('names the app with the venue name and its short name', () => {
    expect(manifest.name).toBe('Claudex Courts')
    expect(manifest.short_name).toBe('Claudex')
  })

  it('opens the booking page, scoped to the whole site, as a standalone app', () => {
    expect(manifest.start_url).toBe('/book')
    expect(manifest.scope).toBe('/')
    expect(manifest.display).toBe('standalone')
  })

  it('takes the colors from the venue theme', () => {
    expect(manifest.theme_color).toBe('#f5efe6')
    expect(manifest.background_color).toBe('#f5efe6')
    expect(buildVenueManifest({ ...venue, theme: 'ocean' }, ctx)).toMatchObject({
      theme_color: '#eef3f6',
      background_color: '#eef3f6',
    })
    expect(buildVenueManifest({ ...venue, theme: 'midnight' }, ctx)).toMatchObject({
      theme_color: '#14151f',
      background_color: '#14151f',
    })
  })

  it('falls back to the Plotline color for a theme it does not know', () => {
    expect(buildVenueManifest({ ...venue, theme: 'neon' }, ctx)).toMatchObject({
      theme_color: '#f5efe6',
      background_color: '#f5efe6',
    })
  })

  it('uses the Plotline icons', () => {
    expect(manifest.icons).toEqual(PLOTLINE_ICONS)
  })

  it('trims the venue name', () => {
    const padded = buildVenueManifest({ ...venue, name: '  Claudex Courts  ' }, ctx)
    expect(padded.name).toBe('Claudex Courts')
    expect(padded.short_name).toBe('Claudex')
  })

  it('shortens a long name to whole words in short_name and keeps the full name', () => {
    const long = buildVenueManifest({ ...venue, name: 'Big Dink Pickleball' }, ctx)
    expect(long.name).toBe('Big Dink Pickleball')
    expect(long.short_name).toBe('Big Dink')
  })
})

describe('buildVenueManifest with a logo', () => {
  const withLogo = (logoPath: string) => buildVenueManifest({ ...venue, logoPath }, ctx)

  it('has exactly two icons, 192 and 512, both the logo URL, purpose any', () => {
    const { icons } = withLogo(LOGO_WEBP)
    expect(icons).toHaveLength(2)
    expect(icons).toEqual([
      { src: storageUrl(LOGO_WEBP), sizes: '192x192', type: 'image/webp', purpose: 'any' },
      { src: storageUrl(LOGO_WEBP), sizes: '512x512', type: 'image/webp', purpose: 'any' },
    ] satisfies ManifestIcon[])
  })

  it('takes the icon type from the file extension', () => {
    expect(withLogo(LOGO_WEBP).icons.map((i) => i.type)).toEqual(['image/webp', 'image/webp'])
    expect(withLogo(LOGO_JPG).icons.map((i) => i.type)).toEqual(['image/jpeg', 'image/jpeg'])
    expect(withLogo(LOGO_JPEG).icons.map((i) => i.type)).toEqual(['image/jpeg', 'image/jpeg'])
    expect(withLogo(LOGO_PNG).icons.map((i) => i.type)).toEqual(['image/png', 'image/png'])
  })

  it('uses the same URL as logoUrl for every icon', () => {
    const expected = logoUrl({ ...venue, logoPath: LOGO_PNG }, SUPABASE_URL)
    for (const icon of withLogo(LOGO_PNG).icons) expect(icon.src).toBe(expected)
  })

  it('never offers a maskable icon, and mixes no Plotline icon in', () => {
    for (const path of [LOGO_WEBP, LOGO_JPG, LOGO_JPEG, LOGO_PNG]) {
      const { icons } = withLogo(path)
      expect(icons.some((i) => i.purpose === 'maskable'), path).toBe(false)
      expect(icons.some((i) => i.src.startsWith('/icons/')), path).toBe(false)
      expect(JSON.stringify(icons), path).not.toContain('maskable')
      expect(JSON.stringify(icons), path).not.toContain('/icons/')
    }
  })

  it('keeps the rest of the manifest as without a logo', () => {
    const a = buildVenueManifest(venue, ctx)
    const b = withLogo(LOGO_PNG)
    expect({ ...b, icons: [] }).toEqual({ ...a, icons: [] })
  })
})

describe('buildVenueManifest is JSON, not HTML', () => {
  it('passes HTML and quote characters through unescaped and round-trips as JSON', () => {
    const name = `Tom's "Best" <Courts> & Co`
    const manifest = buildVenueManifest({ ...venue, name, logoPath: LOGO_PNG }, ctx)
    expect(manifest.name).toBe(name)
    expect(manifest.name).not.toContain('&amp;')
    expect(manifest.name).not.toContain('&lt;')
    expect(manifest.name).not.toContain('&quot;')
    expect(manifest.short_name).not.toMatch(/&(amp|lt|gt|quot|#39);/)
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest)
  })
})

describe('public/manifest.webmanifest (the Plotline fallback)', () => {
  const path = root('public/manifest.webmanifest')

  it('exists and is valid JSON', () => {
    expect(existsSync(path)).toBe(true)
    expect(() => JSON.parse(readFileSync(path, 'utf8'))).not.toThrow()
  })

  it('describes Plotline, standalone, with the Plotline colors and icons', () => {
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      name: 'Plotline',
      short_name: 'Plotline',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: '#f5efe6',
      background_color: '#f5efe6',
    })
    expect(manifest.icons).toEqual(PLOTLINE_ICONS)
  })
})
