import { supabase } from '../../lib/supabase'
import { unwrap } from '../../lib/queryClient'
import type { Enums, Tables, TablesInsert, TablesUpdate } from '../../lib/database.types'

export type VenueSettings = Tables<'venue_settings'>
export type Court = Tables<'courts'>
export type CourtRate = Tables<'court_rates'>
export type OperatingHours = Tables<'operating_hours'>
export type Blackout = Tables<'blackouts'>
export type Sport = Enums<'sport'>

export const SPORTS: Sport[] = ['badminton', 'pickleball', 'basketball', 'tennis']
export const SPORT_LABELS: Record<Sport, string> = {
  badminton: 'Badminton',
  pickleball: 'Pickleball',
  basketball: 'Basketball',
  tennis: 'Tennis',
}

export const catalogKeys = {
  settings: ['venue-settings'] as const,
  courts: (includeInactive: boolean) => ['courts', { includeInactive }] as const,
  allCourts: ['courts'] as const,
  court: (id: string) => ['court', id] as const,
  rates: (courtId: string) => ['court-rates', courtId] as const,
  hours: ['operating-hours'] as const,
  blackouts: ['blackouts'] as const,
}

// --- reads -------------------------------------------------------------------

export async function fetchVenueSettings() {
  return unwrap(await supabase.from('venue_settings').select('*').single())
}

export async function fetchCourts(includeInactive: boolean) {
  let query = supabase.from('courts').select('*').order('sport').order('sort_order').order('name')
  if (!includeInactive) query = query.eq('is_active', true)
  return unwrap(await query)
}

export async function fetchCourt(id: string) {
  return unwrap(await supabase.from('courts').select('*').eq('id', id).single())
}

export async function fetchCourtRates(courtId: string) {
  return unwrap(await supabase.from('court_rates').select('*').eq('court_id', courtId))
}

export async function fetchOperatingHours() {
  return unwrap(await supabase.from('operating_hours').select('*').order('day_of_week'))
}

/** Blackouts that haven't ended yet. */
export async function fetchUpcomingBlackouts() {
  return unwrap(
    await supabase
      .from('blackouts')
      .select('*')
      .gte('ends_at', new Date().toISOString())
      .order('starts_at'),
  )
}

// --- writes (admin only; enforced by RLS) ------------------------------------

export type CourtInput = Pick<
  TablesInsert<'courts'>,
  'name' | 'sport' | 'description' | 'default_hourly_rate' | 'is_active' | 'sort_order'
>

export async function saveCourt(id: string | null, input: CourtInput) {
  const query = id
    ? supabase.from('courts').update(input).eq('id', id).select().single()
    : supabase.from('courts').insert(input).select().single()
  return unwrap(await query)
}

export type RateChanges = {
  upserts: CourtRate[]
  deletes: { day_of_week: number; start_hour: number }[]
}

export async function saveCourtRates(courtId: string, { upserts, deletes }: RateChanges) {
  if (upserts.length) {
    unwrap(await supabase.from('court_rates').upsert(upserts))
  }
  // One delete per weekday keeps the request count small.
  const hoursByDay = new Map<number, number[]>()
  for (const d of deletes) {
    hoursByDay.set(d.day_of_week, [...(hoursByDay.get(d.day_of_week) ?? []), d.start_hour])
  }
  await Promise.all(
    [...hoursByDay].map(async ([day, hours]) =>
      unwrap(
        await supabase
          .from('court_rates')
          .delete()
          .eq('court_id', courtId)
          .eq('day_of_week', day)
          .in('start_hour', hours),
      ),
    ),
  )
}

export async function saveOperatingHours(rows: OperatingHours[]) {
  await Promise.all(
    rows.map(async ({ day_of_week, ...values }) =>
      unwrap(await supabase.from('operating_hours').update(values).eq('day_of_week', day_of_week)),
    ),
  )
}

export async function createBlackout(input: TablesInsert<'blackouts'>) {
  return unwrap(await supabase.from('blackouts').insert(input).select().single())
}

export async function deleteBlackout(id: string) {
  unwrap(await supabase.from('blackouts').delete().eq('id', id))
}

export async function updateVenueSettings(values: TablesUpdate<'venue_settings'>) {
  return unwrap(await supabase.from('venue_settings').update(values).eq('id', true).select().single())
}
