// Link previews per venue (T30.7, SPEC §10 2026-11-21). Runs only for the paths in wrangler.jsonc's
// `assets.run_worker_first` ("/" and "/book"); every other request is served as a static asset without it.
// It rewrites <head> with the venue's name, city, sports and banner so a pasted link shows the venue. It fails open:
// an unknown host, a failed or slow read, or a rewrite error returns the page exactly as the assets serve it.
import { buildVenueCard, renderHeadTags, venueSlugFromHost, type VenueCardData } from './venueCard'

export type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> }
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
}

type Ctx = { waitUntil(promise: Promise<unknown>): void }

const READ_TIMEOUT_MS = 2_000
const CACHE_SECONDS = 300
const SETTINGS_COLUMNS = 'name,city,banner_path,banner_alt,logo_path,sport_order,updated_at'

type SettingsRow = {
  name: string
  city: string | null
  banner_path: string | null
  banner_alt: string | null
  logo_path: string | null
  sport_order: string[] | null
  updated_at: string
}

/** caches.default, or null where there is none (tests, a runtime without the Cache API). */
function edgeCache(): Cache | null {
  try {
    const storage = (globalThis as { caches?: { default?: Cache } }).caches
    return storage?.default ?? null
  } catch {
    return null
  }
}

/** PostgREST embeds the one-to-one `venue_settings` as an object; accept a one-element array as well. */
function toCardData(body: unknown): VenueCardData | null {
  if (!Array.isArray(body) || body.length === 0) return null
  const row = body[0] as { slug?: unknown; venue_settings?: unknown }
  const embedded = Array.isArray(row.venue_settings) ? row.venue_settings[0] : row.venue_settings
  if (typeof row.slug !== 'string' || !embedded || typeof embedded !== 'object') return null
  const s = embedded as SettingsRow
  if (typeof s.name !== 'string' || !s.name.trim()) return null
  return {
    slug: row.slug,
    name: s.name,
    city: typeof s.city === 'string' ? s.city : '',
    bannerPath: s.banner_path ?? null,
    bannerAlt: s.banner_alt ?? null,
    logoPath: s.logo_path ?? null,
    sportOrder: Array.isArray(s.sport_order) ? s.sport_order : [],
    updatedAt: typeof s.updated_at === 'string' ? s.updated_at : '',
  }
}

/** Anon sees active venues only (RLS), and the URL carries nothing from the visitor's request but the slug. */
async function readVenue(slug: string, env: Env): Promise<VenueCardData | null> {
  const url = new URL('/rest/v1/venues', env.SUPABASE_URL)
  url.searchParams.set('slug', `eq.${slug}`)
  url.searchParams.set('status', 'eq.active')
  url.searchParams.set('select', `slug,venue_settings(${SETTINGS_COLUMNS})`)
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}` },
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  })
  if (!response.ok) return null
  return toCardData(await response.json())
}

/** The venue for a slug, from the edge cache (5 minutes) or Supabase. Only a successful read is stored. */
async function venueFor(slug: string, env: Env, ctx: Ctx): Promise<VenueCardData | null> {
  const cache = edgeCache()
  const key = `https://cache.plotline.fit/venue/${slug}`
  if (cache) {
    try {
      const hit = await cache.match(key)
      if (hit) return (await hit.json()) as VenueCardData
    } catch {
      // A cache failure only costs a read.
    }
  }
  const venue = await readVenue(slug, env)
  if (venue && cache) {
    const stored = new Response(JSON.stringify(venue), {
      headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${CACHE_SECONDS}` },
    })
    try {
      ctx.waitUntil(cache.put(key, stored).catch(() => undefined))
    } catch {
      // Not cached this time.
    }
  }
  return venue
}

/** Runs a handler step without letting it break the stream: a throwing handler halts HTMLRewriter mid-page. */
function safely(step: () => void) {
  try {
    step()
  } catch {
    // The element keeps what the asset had.
  }
}

async function handle(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const asset = await env.ASSETS.fetch(request)
  if (request.method !== 'GET' && request.method !== 'HEAD') return asset
  const { hostname, origin, pathname } = new URL(request.url)
  const slug = venueSlugFromHost(hostname)
  if (!slug) return asset
  if (asset.status !== 200 || !(asset.headers.get('content-type') ?? '').includes('text/html')) return asset

  let venue: VenueCardData | null
  try {
    venue = await venueFor(slug, env, ctx)
  } catch {
    return asset
  }
  if (!venue) return asset

  try {
    const card = buildVenueCard(venue, { origin, path: pathname, supabaseUrl: env.SUPABASE_URL })
    const tags = renderHeadTags(card)
    // Rewrite a copy, so the untouched asset is still there to return if the rewrite throws.
    return new HTMLRewriter()
      .on('title', { element: (el) => safely(() => el.setInnerContent(card.title)) })
      .on('head', { element: (el) => safely(() => el.append(tags, { html: true })) })
      .transform(asset.clone())
  } catch {
    return asset
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    return handle(request, env, ctx)
  },
}
