// Which venue (or the platform console) a hostname selects (SPEC §10 2026-10-31, RESEARCH M13).

/** Never a venue slug (PLATFORM.md §3). The database's `venues_slug_not_reserved` check differs until T13.5 aligns it. */
export const RESERVED_SUBDOMAINS: readonly string[] = [
  'www', 'app', 'api', 'admin', 'demo', 'staging', 'mail', 'help', 'blog', 'status', 'support',
]

export type HostMode = { mode: 'venue'; slug: string } | { mode: 'console' } | { mode: 'none' }

type OverrideStorage = Pick<Storage, 'getItem' | 'setItem'>

/** Hosts whose subdomain names the venue. Anywhere else (bare localhost, previews) uses `?venue=`. */
const VENUE_DOMAINS = ['plotline.fit', 'localhost']
const CONSOLE_SUBDOMAIN = 'app'
const OVERRIDE_KEY = 'plotline:venue'

/** The format is the `venues_slug_format` check's. */
function isVenueSlug(value: string) {
  return /^[a-z0-9-]{3,40}$/.test(value) && !RESERVED_SUBDOMAINS.includes(value)
}

export function resolveHost(hostname: string, search: string, storage: OverrideStorage): HostMode {
  const host = hostname.toLowerCase()
  const domain = VENUE_DOMAINS.find((d) => host === d || host.endsWith(`.${d}`))
  // Bare `localhost` has no subdomain, so it takes the override like a preview host.
  if (domain && host !== 'localhost') {
    const sub = host.slice(0, -(domain.length + 1))
    if (sub === CONSOLE_SUBDOMAIN) return { mode: 'console' }
    return isVenueSlug(sub) ? { mode: 'venue', slug: sub } : { mode: 'none' }
  }

  const query = new URLSearchParams(search).get('venue')
  if (query !== null) {
    if (!isVenueSlug(query)) return { mode: 'none' }
    storage.setItem(OVERRIDE_KEY, query)
    return { mode: 'venue', slug: query }
  }
  const stored = storage.getItem(OVERRIDE_KEY)
  return stored !== null && isVenueSlug(stored) ? { mode: 'venue', slug: stored } : { mode: 'none' }
}

export function getVenueSlug(hostname: string, search: string, storage: OverrideStorage): string | null {
  const host = resolveHost(hostname, search, storage)
  return host.mode === 'venue' ? host.slug : null
}
