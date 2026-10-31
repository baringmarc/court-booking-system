// Where a venue's links point (T13.6). Never a free client value: a subdomain is built only from a slug read from the
// database, and the request Origin counts only when it is that same subdomain or an exact allow-list entry.

const SLUG = /^[a-z0-9-]{3,40}$/
const ROOT_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/
// Same names as the database's venues_slug_not_reserved check and PLATFORM.md §3.
const RESERVED = ['www', 'app', 'api', 'admin', 'demo', 'staging', 'mail', 'help', 'blog', 'status', 'support', 'plotline']

export type VenueSiteInput = {
  slug: string | null | undefined
  origin: string | null
  /** e.g. `plotline.fit` (secret PUBLIC_ROOT_DOMAIN); unset locally. */
  rootDomain: string | undefined
  /** Comma-separated exact sites (secret PUBLIC_SITE_URL): localhost and the old Vercel URL. */
  allowList: string | undefined
}

export function venueSiteBase({ slug, origin, rootDomain, allowList }: VenueSiteInput): string | null {
  const sites = (allowList ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => /^https?:\/\/[^\s/]+$/.test(s))
  const root = rootDomain ?? ''
  const own =
    ROOT_DOMAIN.test(root) && slug && SLUG.test(slug) && !RESERVED.includes(slug) ? `https://${slug}.${root}` : null
  const requested = origin?.replace(/\/+$/, '') ?? ''
  if (requested && (requested === own || sites.includes(requested))) return requested
  return own ?? sites[0] ?? null
}
