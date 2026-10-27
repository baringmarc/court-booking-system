// Plain-language text for a booking's reschedules (T10.10). Times are in the venue timezone.
import { formatHour } from '../../lib/format'
import { formatDateLabel, hourInZone, todayInZone } from '../../lib/time'
import type { BookingChange, BookingContinuation } from './api'

/** "Sat, Oct 17, 3 PM–5 PM" for a range that starts on one venue date. */
export function rangeLabel(start: string, end: string, timeZone: string) {
  const date = formatDateLabel(todayInZone(timeZone, new Date(start)), timeZone)
  return `${date}, ${formatHour(hourInZone(start, timeZone))}–${formatHour(hourInZone(end, timeZone))}`
}

/** "Moved from Sat, Oct 17, 3 PM–5 PM to Sun, Oct 18, 4 PM–6 PM (Badminton 2)". */
export function describeChange(change: BookingChange, timeZone: string) {
  const sameCourt = change.old_court_name === change.new_court_name
  const from = `${rangeLabel(change.old_start, change.old_end, timeZone)}${sameCourt ? '' : ` (${change.old_court_name})`}`
  const to = `${rangeLabel(change.new_start, change.new_end, timeZone)} (${change.new_court_name})`
  return `Moved from ${from} to ${to}`
}

/** "1 hour moved to Sun, Oct 18, 4 PM–5 PM (Badminton 2)". */
export function describeContinuation(part: BookingContinuation, timeZone: string) {
  const hours = Math.round((Date.parse(part.slot_end) - Date.parse(part.slot_start)) / 3_600_000)
  return `${hours} ${hours === 1 ? 'hour' : 'hours'} moved to ${rangeLabel(part.slot_start, part.slot_end, timeZone)} (${part.court_name})`
}
