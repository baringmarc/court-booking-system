/** The marketing site (plotline-site, docs/PLATFORM.md §1). */
export const MARKETING_URL = 'https://plotline.fit'

/** The hand-off from /admin/open-play (PLATFORM.md §4): the code in the query, the secret only in the fragment. */
export function liveStackHandoffUrl(code: string, secret: string): string {
  return `${MARKETING_URL}/paddle-stack?live=${encodeURIComponent(code)}#key=${encodeURIComponent(secret)}`
}
