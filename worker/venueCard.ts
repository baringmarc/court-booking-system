// The venue card a pasted link shows (T30.7): pure functions, no Workers globals, so Vitest runs them as they are.

/**
 * A mirror of `RESERVED_SUBDOMAINS` in src/lib/venueHost.ts (a test keeps them equal). The Worker doesn't import app
 * code, so app changes never change what the edge bundles.
 */
export const RESERVED_SUBDOMAINS: readonly string[] = [
  'www', 'app', 'api', 'admin', 'demo', 'staging', 'mail', 'help', 'blog', 'status', 'support',
]

const VENUE_DOMAINS = ['plotline.fit', 'localhost']

/** The venue branch of the app's `resolveHost`: `<slug>.plotline.fit` or `<slug>.localhost`. No `?venue=` override. */
export function venueSlugFromHost(hostname: string): string | null {
  const host = hostname.toLowerCase()
  const domain = VENUE_DOMAINS.find((d) => host.endsWith(`.${d}`))
  if (!domain) return null
  const sub = host.slice(0, -(domain.length + 1))
  // The `venues_slug_format` check; `app` (the console) is reserved, so it is never a venue.
  return /^[a-z0-9-]{3,40}$/.test(sub) && !RESERVED_SUBDOMAINS.includes(sub) ? sub : null
}

export type VenueCardData = {
  slug: string
  name: string
  city: string
  bannerPath: string | null
  bannerAlt: string | null
  logoPath: string | null
  sportOrder: string[]
  updatedAt: string
}

export type VenueCard = {
  title: string
  description: string
  image: string
  imageAlt: string | null
  url: string
  twitterCard: 'summary_large_image' | 'summary'
  appTitle: string
}

/** src/features/catalog/sports.ts's labels. */
const SPORT_LABELS: Record<string, string> = {
  badminton: 'Badminton',
  pickleball: 'Pickleball',
  basketball: 'Basketball',
  tennis: 'Tennis',
}

function listOf(items: string[]) {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export function buildVenueCard(
  venue: VenueCardData,
  ctx: { origin: string; path: string; supabaseUrl: string },
): VenueCard {
  // The same public URL `getPublicUrl` builds (src/features/catalog/media.ts). `?v=` makes a replaced photo a new URL,
  // since Facebook caches images by URL.
  const media = (path: string) =>
    `${ctx.supabaseUrl}/storage/v1/object/public/venue-media/${path}?v=${encodeURIComponent(venue.updatedAt)}`

  const sports = listOf(venue.sportOrder.map((s) => SPORT_LABELS[s]).filter((label): label is string => !!label))
  const place = venue.city.trim() ? `${venue.name} in ${venue.city.trim()}` : venue.name
  const description = sports ? `Book ${sports} courts at ${place}.` : `Book a court at ${place}.`

  let image: string
  let imageAlt: string | null
  let twitterCard: VenueCard['twitterCard']
  if (venue.bannerPath) {
    image = media(venue.bannerPath)
    imageAlt = venue.bannerAlt?.trim() ? venue.bannerAlt.trim() : null
    twitterCard = 'summary_large_image'
  } else if (venue.logoPath) {
    image = media(venue.logoPath)
    imageAlt = `${venue.name} logo`
    twitterCard = 'summary'
  } else {
    image = `${ctx.origin}/plotline-card.png`
    imageAlt = null
    twitterCard = 'summary_large_image'
  }

  // Path only: a query or hash can carry a booking reference or token.
  const path = ctx.path.split(/[?#]/)[0] || '/'

  return {
    title: `${venue.name} · Book a court`,
    description,
    image,
    imageAlt,
    url: `${ctx.origin}${path}`,
    twitterCard,
    appTitle: venue.name,
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** The `<meta>` tags appended to `<head>`. The `<title>` is set separately (HTMLRewriter escapes text content). */
export function renderHeadTags(card: VenueCard): string {
  const tags: Array<[attr: 'name' | 'property', key: string, value: string]> = [
    ['name', 'description', card.description],
    ['property', 'og:type', 'website'],
    ['property', 'og:title', card.title],
    ['property', 'og:description', card.description],
    ['property', 'og:url', card.url],
    ['property', 'og:image', card.image],
  ]
  if (card.imageAlt !== null) tags.push(['property', 'og:image:alt', card.imageAlt])
  tags.push(['name', 'twitter:card', card.twitterCard], ['name', 'apple-mobile-web-app-title', card.appTitle])
  return tags.map(([attr, key, value]) => `<meta ${attr}="${escapeHtml(key)}" content="${escapeHtml(value)}">`).join('')
}
