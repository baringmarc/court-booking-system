import { supabase } from '../../lib/supabase'
import { unwrap } from '../../lib/queryClient'
import type { Tables } from '../../lib/database.types'

// Public reads for the venue info (T9.11g). The admin writes are in admin/api.ts, out of the public bundle.
export type SocialLink = Pick<Tables<'venue_social_links'>, 'platform' | 'url'>
export type InfoSection = Pick<Tables<'venue_info_sections'>, 'id' | 'title' | 'body' | 'sort_order'>
export type Amenity = Pick<Tables<'venue_amenities'>, 'id' | 'builtin_key' | 'custom_name' | 'created_at'>
export type PaymentAccount = Pick<Tables<'venue_payment_accounts'>, 'id' | 'label' | 'account_name' | 'account_number' | 'qr_path' | 'position'>

export const venueKeys = {
  socials: ['venue-socials'] as const,
  sections: ['venue-sections'] as const,
  amenities: ['venue-amenities'] as const,
  paymentAccounts: ['venue-payment-accounts'] as const,
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

/** Where players send manual payments (T11.10), in display order. */
export async function fetchPaymentAccounts(): Promise<PaymentAccount[]> {
  return unwrap(
    await supabase.from('venue_payment_accounts')
      .select('id, label, account_name, account_number, qr_path, position')
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
