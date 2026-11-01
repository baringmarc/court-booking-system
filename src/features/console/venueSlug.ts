/** A subdomain suggestion from a venue name: a-z, 0-9 and single hyphens, at most 40 characters (`venues_slug_format`). */
export function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
    .replace(/-+$/, '')
}
