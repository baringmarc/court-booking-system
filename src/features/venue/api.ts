import { supabase } from '../../lib/supabase'
import { unwrap } from '../../lib/queryClient'
import type { Tables } from '../../lib/database.types'

// Public reads for the venue info (T9.11g). The admin writes are in admin/api.ts, out of the public bundle.
export type SocialLink = Pick<Tables<'venue_social_links'>, 'platform' | 'url'>
export type InfoSection = Pick<Tables<'venue_info_sections'>, 'id' | 'title' | 'body' | 'sort_order'>
export type Amenity = Pick<Tables<'venue_amenities'>, 'id' | 'builtin_key' | 'custom_name' | 'created_at'>

export const venueKeys = {
  socials: ['venue-socials'] as const,
  sections: ['venue-sections'] as const,
  amenities: ['venue-amenities'] as const,
}

export async function fetchSocialLinks(): Promise<SocialLink[]> {
  return unwrap(await supabase.from('venue_social_links').select('platform, url'))
}

/** In display order. */
export async function fetchInfoSections(): Promise<InfoSection[]> {
  return unwrap(
    await supabase.from('venue_info_sections').select('id, title, body, sort_order').order('sort_order').order('created_at').order('id'),
  )
}

export async function fetchAmenities(): Promise<Amenity[]> {
  return unwrap(await supabase.from('venue_amenities').select('id, builtin_key, custom_name, created_at'))
}
