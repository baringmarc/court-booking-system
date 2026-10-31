type Location = { protocol: string; hostname: string; port: string }

/** Where a venue's admin lives, seen from the current page: its own subdomain, or `?venue=` on hosts without one. */
export function venueAdminUrl(slug: string, loc: Location): string {
  const host = loc.hostname.toLowerCase()
  const domain = ['plotline.fit', 'localhost'].find((d) => host.endsWith(`.${d}`))
  if (!domain) return `/admin?venue=${encodeURIComponent(slug)}`
  return `${loc.protocol}//${slug}.${domain}${loc.port ? `:${loc.port}` : ''}/admin`
}
