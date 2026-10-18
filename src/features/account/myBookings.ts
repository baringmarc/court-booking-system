import { isActive } from '../booking/cancellation'
import type { MyBooking } from './api'

/**
 * Upcoming: still holds its slot (live hold, proof under review, or confirmed) and hasn't ended,
 * soonest first. Past: everything else (completed, expired, rejected, cancelled), most recent first.
 */
export function splitMyBookings(rows: MyBooking[], now: Date) {
  const upcoming: MyBooking[] = []
  const past: MyBooking[] = []
  for (const row of rows) {
    if (isActive(row, now) && Date.parse(row.slot_end) > now.getTime()) upcoming.push(row)
    else past.push(row)
  }
  upcoming.sort((a, b) => a.slot_start.localeCompare(b.slot_start))
  past.sort((a, b) => b.slot_start.localeCompare(a.slot_start))
  return { upcoming, past }
}
