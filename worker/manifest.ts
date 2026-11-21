// The web manifest a venue host serves (T30.8, SPEC §10 2026-11-21): Add to Home Screen installs the venue under its
// own name and logo. Pure functions, no Workers globals, so Vitest runs them as they are. No service worker (the
// user's call at the plan gate): Chrome's menu Install and iOS Add to Home Screen need only this manifest.
import type { VenueCardData } from './venueCard'

export type ManifestIcon = { src: string; sizes: string; type: string; purpose: 'any' | 'maskable' }

export type WebManifest = {
  name: string
  short_name: string
  start_url: string
  scope: string
  display: 'standalone'
  theme_color: string
  background_color: string
  icons: ManifestIcon[]
}

/** The Plotline icons in public/icons/ (rendered from public/favicon.svg); also in public/manifest.webmanifest. */
export const PLOTLINE_ICONS: ManifestIcon[] = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]

/**
 * A mirror of each preset's light page background, `THEME_SWATCHES[key].light.bg` in src/lib/themes.ts (a test keeps
 * them equal). The Worker doesn't import app code, so app changes never change what the edge bundles.
 */
export const THEME_BACKGROUNDS: Record<string, string> = {
  plotline: '#f5efe6',
  'court-green': '#eef6f1',
  ocean: '#eef3f6',
  plum: '#f6eef6',
  sunset: '#f6f2ee',
  slate: '#f1f2f3',
  midnight: '#14151f',
}

const SHORT_NAME_MAX = 12

/** The launcher label: the whole name when it fits in 12 characters, else the leading whole words that fit. */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const length = (text: string) => [...text].length
  const whole = words.join(' ')
  if (length(whole) <= SHORT_NAME_MAX) return whole
  let out = ''
  for (const word of words) {
    const next = out ? `${out} ${word}` : word
    if (length(next) > SHORT_NAME_MAX) break
    out = next
  }
  return out || [...words[0]].slice(0, SHORT_NAME_MAX).join('')
}

/** theme_color and background_color: the preset's light page background; anything unknown is Plotline's. */
export function manifestColors(theme: string | null | undefined): { theme_color: string; background_color: string } {
  const color =
    typeof theme === 'string' && Object.prototype.hasOwnProperty.call(THEME_BACKGROUNDS, theme)
      ? THEME_BACKGROUNDS[theme]
      : THEME_BACKGROUNDS.plotline
  return { theme_color: color, background_color: color }
}

/** The logo's public URL, versioned like the card's images (worker/venueCard.ts), or null without a logo. */
export function logoUrl(venue: VenueCardData, supabaseUrl: string): string | null {
  if (!venue.logoPath) return null
  return `${supabaseUrl}/storage/v1/object/public/venue-media/${venue.logoPath}?v=${encodeURIComponent(venue.updatedAt)}`
}

function imageType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'webp') return 'image/webp'
  if (ext === 'png') return 'image/png'
  return 'image/jpeg'
}

export function buildVenueManifest(venue: VenueCardData, ctx: { supabaseUrl: string }): WebManifest {
  const logo = logoUrl(venue, ctx.supabaseUrl)
  // The logo alone when set (the user's call): listed beside the Plotline icons, the launcher might pick Plotline's.
  // At most 512 px square (T29.6), declared at both sizes Chrome looks for; never maskable, since a logo on a
  // transparent background would be cropped (RESEARCH "Milestone 30").
  const icons: ManifestIcon[] =
    logo && venue.logoPath
      ? (['192x192', '512x512'] as const).map((sizes) => ({ src: logo, sizes, type: imageType(venue.logoPath ?? ''), purpose: 'any' as const }))
      : PLOTLINE_ICONS.map((icon) => ({ ...icon }))
  return {
    name: venue.name.trim(),
    short_name: shortName(venue.name),
    start_url: '/book',
    scope: '/',
    display: 'standalone',
    ...manifestColors(venue.theme),
    icons,
  }
}
