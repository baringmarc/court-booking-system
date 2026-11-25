import { isActive } from '../booking/cancellation'
import { groupDisplayStatus } from '../booking/group'
import { displayStatus } from '../booking/status'
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

/**
 * One row per checkout (T33.4, SPEC §7): the rows of a booking group become the earliest-starting court's row (then
 * reference) with `courts` = every court, the summed `amount_due`, the span of the courts that aren't cancelled (all of
 * them when every one is), and the status and hold of the first court showing the group's status, so displayStatus of
 * the row is the group's. Rows without a group pass through in order; the group sits where its first row was.
 */
export function collapseGroups(rows: MyBooking[], now = new Date()): MyBooking[] {
  const groups = new Map<string, MyBooking[]>()
  for (const row of rows) {
    if (!row.booking_group_id) continue
    const list = groups.get(row.booking_group_id) ?? []
    list.push(row)
    groups.set(row.booking_group_id, list)
  }
  const out: MyBooking[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const id = row.booking_group_id
    if (!id) { out.push(row); continue }
    if (seen.has(id)) continue
    seen.add(id)
    const courts = [...groups.get(id)!].sort((a, b) =>
      Date.parse(a.slot_start) - Date.parse(b.slot_start) || a.reference_code.localeCompare(b.reference_code))
    const standing = courts.filter((c) => c.status !== 'cancelled')
    const span = standing.length > 0 ? standing : courts
    const status = groupDisplayStatus(courts, now)
    const shown = courts.find((c) => displayStatus(c, now) === status) ?? courts[0]
    out.push({
      ...courts[0],
      status: shown.status,
      expires_at: shown.expires_at,
      amount_due: courts.reduce((total, c) => total + c.amount_due, 0),
      slot_start: span.map((c) => c.slot_start).reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a)),
      slot_end: span.map((c) => c.slot_end).reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a)),
      courts,
    })
  }
  return out
}
