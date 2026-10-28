// The venue's Google Maps link (T11.8, T11.9): pasted by the admin, never built into an embedded map.

export const MAPS_URL_MAX = 1000
/** Mirrors the venue_settings_maps_url_link check: https on one of four Maps hosts, then `/ ? #` or the end. */
const MAPS_URL = /^https:\/\/(www\.google\.com\/maps|maps\.google\.com|maps\.app\.goo\.gl|goo\.gl\/maps)([/?#]\S*)?$/

/** Why a pasted link can't be saved, or null when it can (empty means no link). */
export function mapsUrlProblem(url: string): string | null {
  if (url === '') return null
  if (url.length > MAPS_URL_MAX) return `The link must be at most ${MAPS_URL_MAX} characters.`
  if (!MAPS_URL.test(url)) return 'Paste a Google Maps link (https://maps.app.goo.gl/… or https://www.google.com/maps/…).'
  return null
}

/** The place name in a long link's `/maps/place/<name>/`, to pre-fill an empty address. Short links have none. */
export function placeNameFromMapsUrl(url: string): string {
  const match = url.match(/^https:\/\/(?:www|maps)\.google\.com\/maps\/place\/([^/?#]+)/)
  if (!match) return ''
  try {
    return decodeURIComponent(match[1].replace(/\+/g, ' ')).trim().slice(0, 300)
  } catch {
    return '' // a malformed %-escape
  }
}
