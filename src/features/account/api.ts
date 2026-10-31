// Player account data: My bookings and claiming earlier guest bookings (SPEC §5.7, §7).
import { supabase } from '../../lib/supabase'
import { currentVenueId } from '../../lib/currentVenue'
import { unwrap } from '../../lib/queryClient'
import type { Enums } from '../../lib/database.types'
import { parseTstzRange } from '../../lib/time'
import type { BookingStatus } from '../booking/status'

export type MyBooking = {
  id: string
  reference_code: string
  court_name: string
  sport: Enums<'sport'> | null
  slot_start: string
  slot_end: string
  status: BookingStatus
  expires_at: string | null
  /** What the player pays: the court price plus the booking fee (T11.12). */
  amount_due: number
  /** Set on a moved part (T10.9): the booking it was split from. */
  parent_booking_id: string | null
  /** When it was booked (the "Booked on" sort, T11.5b). */
  created_at: string
}

export const MY_BOOKINGS_LIMIT = 200

/**
 * The player's own bookings through RLS. The explicit user_id filter matters: an admin's RLS
 * returns every booking at the venue (RESEARCH "My bookings query").
 */
export async function fetchMyBookings(userId: string): Promise<MyBooking[]> {
  const rows = unwrap(
    await supabase
      .from('bookings')
      .select('id, reference_code, during, status, expires_at, amount_due, parent_booking_id, created_at, courts(name, sport)')
      .eq('user_id', userId)
      .eq('venue_id', currentVenueId())
      .order('during', { ascending: false })
      .limit(MY_BOOKINGS_LIMIT),
  )
  return rows.map((row) => {
    const { start, end } = parseTstzRange(row.during)
    return {
      id: row.id,
      reference_code: row.reference_code,
      // Archived courts are hidden from players by RLS, so the join can be empty.
      court_name: row.courts?.name ?? 'Court',
      sport: row.courts?.sport ?? null,
      slot_start: start,
      slot_end: end,
      status: row.status,
      expires_at: row.expires_at,
      amount_due: Number(row.amount_due),
      parent_booking_id: row.parent_booking_id,
      created_at: row.created_at,
    }
  })
}

/** Links earlier guest bookings with the caller's confirmed email; returns how many. Idempotent. */
export async function claimGuestBookings(): Promise<number> {
  return unwrap(await supabase.rpc('claim_guest_bookings'))
}
