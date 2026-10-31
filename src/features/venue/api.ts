import { supabase } from '../../lib/supabase'
import { unwrap } from '../../lib/queryClient'
import type { Tables } from '../../lib/database.types'
import { currentVenueId, type CurrentVenue } from '../../lib/currentVenue'

// Public reads for the venue info (T9.11g). The admin writes are in admin/api.ts, out of the public bundle.
export type SocialLink = Pick<Tables<'venue_social_links'>, 'platform' | 'url'>
export type InfoSection = Pick<Tables<'venue_info_sections'>, 'id' | 'title' | 'body' | 'sort_order'>
export type Amenity = Pick<Tables<'venue_amenities'>, 'id' | 'builtin_key' | 'custom_name' | 'created_at'>
export type PaymentAccount = Pick<Tables<'venue_payment_accounts'>, 'id' | 'label' | 'account_name' | 'account_number' | 'qr_path' | 'position'>

// Every key starts with the venue id (see catalogKeys).
export const venueKeys = {
  socials: () => [currentVenueId(), 'venue-socials'] as const,
  sections: () => [currentVenueId(), 'venue-sections'] as const,
  amenities: () => [currentVenueId(), 'venue-amenities'] as const,
  paymentAccounts: () => [currentVenueId(), 'venue-payment-accounts'] as const,
}

/** The venue a page belongs to. RLS shows anon only active venues, so a draft or suspended venue is null here. */
export async function fetchVenueBySlug(slug: string): Promise<CurrentVenue | null> {
  return unwrap(await supabase.from('venues').select('id, slug, status').eq('slug', slug).maybeSingle())
}

export async function fetchSocialLinks(): Promise<SocialLink[]> {
  return unwrap(await supabase.from('venue_social_links').select('platform, url').eq('venue_id', currentVenueId()))
}

/** In display order. */
export async function fetchInfoSections(): Promise<InfoSection[]> {
  return unwrap(
    await supabase.from('venue_info_sections').select('id, title, body, sort_order').eq('venue_id', currentVenueId()).order('sort_order').order('created_at').order('id'),
  )
}

export async function fetchAmenities(): Promise<Amenity[]> {
  return unwrap(await supabase.from('venue_amenities').select('id, builtin_key, custom_name, created_at').eq('venue_id', currentVenueId()))
}

/** Where players send manual payments (T11.10), in display order. */
export async function fetchPaymentAccounts(): Promise<PaymentAccount[]> {
  return unwrap(
    await supabase.from('venue_payment_accounts')
      .select('id, label, account_name, account_number, qr_path, position')
      .eq('venue_id', currentVenueId())
      .order('position').order('created_at').order('id'),
  )
}

/** QR images live in their own public bucket (T11.10): 1 MB, PNG only. */
export const PAYMENT_QR_BUCKET = 'payment-qr'

export function qrImageUrl(path: string) {
  return supabase.storage.from(PAYMENT_QR_BUCKET).getPublicUrl(path).data.publicUrl
}

/** The same image served as an attachment: `<a download>` is ignored for another origin, so Storage names the file. */
export function qrDownloadUrl(path: string, label: string) {
  const name = `${label.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'payment'}-qr.png`
  return supabase.storage.from(PAYMENT_QR_BUCKET).getPublicUrl(path, { download: name }).data.publicUrl
}
