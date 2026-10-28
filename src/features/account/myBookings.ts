import { isActive } from '../booking/cancellation'
import type { MyBooking } from './api'

/** My bookings' sort (T11.5b): play time (upcoming soonest, past most recent) or when it was booked. */
export type MySort = 'play' | 'booked-desc' | 'booked-asc'
export const MY_SORTS: readonly { value: MySort; label: string }[] = [
  { value: 'play', label: 'Play time' },
  { value: 'booked-desc', label: 'Booked on, newest first' },
  { value: 'booked-asc', label: 'Booked on, oldest first' },
]

/** The sort in the URL (`?sort=`), or the default. */
export function mySortFromParams(params: URLSearchParams): MySort {
  const sort = params.get('sort')
  return MY_SORTS.some((s) => s.value === sort) ? (sort as MySort) : 'play'
}

/**
 * Upcoming: still holds its slot (live hold, proof under review, or confirmed) and hasn't ended.
 * Past: everything else (completed, expired, rejected, cancelled). By play time, upcoming is soonest first and past
 * most recent first; "Booked on" sorts both by when they were booked instead (ties by reference).
 */
export function splitMyBookings(rows: MyBooking[], now: Date, sort: MySort = 'play') {
  const upcoming: MyBooking[] = []
  const past: MyBooking[] = []
  for (const row of rows) {
    if (isActive(row, now) && Date.parse(row.slot_end) > now.getTime()) upcoming.push(row)
    else past.push(row)
  }
  if (sort === 'play') {
    upcoming.sort((a, b) => a.slot_start.localeCompare(b.slot_start))
    past.sort((a, b) => b.slot_start.localeCompare(a.slot_start))
  } else {
    const dir = sort === 'booked-desc' ? -1 : 1
    const byBooked = (a: MyBooking, b: MyBooking) =>
      dir * a.created_at.localeCompare(b.created_at) || a.reference_code.localeCompare(b.reference_code)
    upcoming.sort(byBooked)
    past.sort(byBooked)
  }
  return { upcoming, past }
}
