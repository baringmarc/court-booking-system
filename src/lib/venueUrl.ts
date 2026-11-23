type Location = { protocol: string; hostname: string; port: string }

/** Where a venue's admin lives, seen from the current page: its own subdomain, or `?venue=` on hosts without one. */
export function venueAdminUrl(slug: string, loc: Location): string {
  const host = loc.hostname.toLowerCase()
  const domain = ['plotline.fit', 'localhost'].find((d) => host.endsWith(`.${d}`))
  if (!domain) return `/admin?venue=${encodeURIComponent(slug)}`
  return `${loc.protocol}//${slug}.${domain}${loc.port ? `:${loc.port}` : ''}/admin`
}

/**
 * A venue's public booking page as absolute text, for a caption players read or tap (T31.1): its own subdomain, or
 * `/book?venue=` on the current host when that host has no venue subdomains.
 */
export function venueBookUrl(slug: string, loc: Location): string {
  const host = loc.hostname.toLowerCase()
  const port = loc.port ? `:${loc.port}` : ''
  const domain = ['plotline.fit', 'localhost'].find((d) => host.endsWith(`.${d}`))
  if (!domain) return `${loc.protocol}//${host}${port}/book?venue=${encodeURIComponent(slug)}`
  return `${loc.protocol}//${slug}.${domain}${port}/book`
}
