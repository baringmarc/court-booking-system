// Promo rates (T19.2). Admins read their venue's promos through RLS; writes go through save_court_promo and
// delete_court_promo (T19.1), which check the overlap rule. Only imported by the lazy admin schedule page.
import { supabase } from '../../../lib/supabase'
import { unwrap } from '../../../lib/queryClient'
import { currentVenueId } from '../../../lib/currentVenue'
import type { Tables } from '../../../lib/database.types'

type PromoRow = Tables<'court_promos'>

export type Promo = Pick<PromoRow, 'id' | 'label' | 'starts_on' | 'ends_on' | 'days_of_week' | 'start_hour' | 'end_hour' | 'price' | 'is_active'> & {
  court_ids: string[]
}

export type PromoInput = {
  /** null creates a promo. */
  id: string | null
  label: string
  starts_on: string
  ends_on: string
  court_ids: string[]
  days: number[]
  start_hour: number
  end_hour: number
  price: number
  is_active: boolean
}

export const promoKeys = {
  all: () => [currentVenueId(), 'admin-promos'] as const,
}

// One literal: supabase-js infers the embedded links' type from it.
const PROMO_SELECT = '*, court_promo_courts(court_id)' as const

export async function fetchPromos(): Promise<Promo[]> {
  const rows = unwrap(await supabase.from('court_promos').select(PROMO_SELECT)
    .eq('venue_id', currentVenueId()).order('starts_on').order('label'))
  return rows.map(({ court_promo_courts, ...p }) => ({
    id: p.id, label: p.label, starts_on: p.starts_on, ends_on: p.ends_on, days_of_week: p.days_of_week,
    start_hour: p.start_hour, end_hour: p.end_hour, price: p.price, is_active: p.is_active,
    court_ids: (court_promo_courts ?? []).map((c) => c.court_id),
  }))
}

export async function savePromo(input: PromoInput): Promise<string> {
  return unwrap(await supabase.rpc('save_court_promo', {
    // The generated type says string, but the RPC takes null to create (SPEC §6).
    p_id: input.id as string,
    p_label: input.label,
    p_starts_on: input.starts_on,
    p_ends_on: input.ends_on,
    p_court_ids: input.court_ids,
    p_days: input.days,
    p_start_hour: input.start_hour,
    p_end_hour: input.end_hour,
    p_price: input.price,
    p_is_active: input.is_active,
  }))
}

export async function deletePromo(id: string): Promise<void> {
  unwrap(await supabase.rpc('delete_court_promo', { p_id: id }))
}
