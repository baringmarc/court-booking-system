// Venue media (court photos, banner) live in the public `venue-media` bucket. The database stores object
// paths, not URLs, so the same row works locally and on the hosted project (RESEARCH M6).
import { supabase } from '../../lib/supabase'

export const VENUE_MEDIA_BUCKET = 'venue-media'

/** Public URL for a stored object path. Synchronous: it only builds the URL. */
export function mediaUrl(path: string) {
  return supabase.storage.from(VENUE_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl
}
