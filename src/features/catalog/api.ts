import { supabase } from '../../lib/supabase'
import { unwrap } from '../../lib/queryClient'
import type { Tables, TablesInsert, TablesUpdate } from '../../lib/database.types'
import { sortCourts } from './sportOrder'

export type VenueSettings = Tables<'venue_settings'>
export type Court = Tables<'courts'>
/** A court photo (M9). The lowest sort_order is the cover. */
export type CourtPhotoRow = Pick<Tables<'court_photos'>, 'id' | 'path' | 'sort_order'>
export type CourtWithPhotos = Court & { court_photos: CourtPhotoRow[] }
export type CourtRate = Tables<'court_rates'>
export type OperatingHours = Tables<'operating_hours'>
export type Blackout = Tables<'blackouts'>
export { SPORTS, SPORT_LABELS, type Sport } from './sports'

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

// One literal, so supabase-js infers the embedded photos' type from it.
const COURT_SELECT = '*, court_photos(id, path, sort_order)' as const

/** Photos in gallery order: the cover first. */
function withSortedPhotos<T extends { court_photos: CourtPhotoRow[] }>(court: T): T {
  return {
    ...court,
    court_photos: [...court.court_photos].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)),
  }
}

/** Courts in display order: sports in the venue's sport_order, then sort_order and name (as get_availability). */
export async function fetchCourts(includeInactive: boolean): Promise<CourtWithPhotos[]> {
  let query = supabase.from('courts').select(COURT_SELECT)
  if (!includeInactive) query = query.eq('is_active', true)
  const [courts, settings] = await Promise.all([
    query,
    supabase.from('venue_settings').select('sport_order').single(),
  ])
  return sortCourts(unwrap(courts).map(withSortedPhotos), unwrap(settings).sport_order)
}

export async function fetchCourt(id: string): Promise<CourtWithPhotos> {
  return withSortedPhotos(unwrap(await supabase.from('courts').select(COURT_SELECT).eq('id', id).single()))
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
  upserts: Omit<CourtRate, 'venue_id'>[]
  deletes: { day_of_week: number; start_hour: number }[]
}

export async function saveCourtRates(courtId: string, { upserts, deletes }: RateChanges) {
  if (upserts.length) {
    unwrap(await supabase.from('court_rates').upsert(upserts as TablesInsert<'court_rates'>[]))
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

/** Saves the whole week in one step (set_operating_hours: atomic, checks that days don't overlap). */
export async function saveOperatingHours(rows: OperatingHours[]) {
  const p_hours = rows.map(({ day_of_week, open_time, close_time, is_closed }) => ({ day_of_week, open_time, close_time, is_closed }))
  unwrap(await supabase.rpc('set_operating_hours', { p_hours }))
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
