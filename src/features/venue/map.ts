// The venue map (T9.11g): built from stored text fields only, never from a pasted iframe or URL.

/** The official Maps Embed API with a referrer-restricted browser key, or the keyless embed without one. */
export function mapEmbedUrl(query: string, apiKey?: string) {
  const q = encodeURIComponent(query.trim())
  return apiKey
    ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(apiKey)}&q=${q}`
    : `https://www.google.com/maps?q=${q}&output=embed`
}

/** "Open in Google Maps": Maps URLs, no key needed. */
export function mapsSearchUrl(query: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query.trim())}`
}

/** What the map searches: the map query, or the address when there's none. Empty means no map. */
export function mapQueryOf(settings: { address: string; maps_query: string }) {
  return settings.maps_query.trim() || settings.address.trim()
}

/** The embed key from the environment (optional; see .env.example). */
export const MAPS_EMBED_KEY: string | undefined = import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY || undefined
