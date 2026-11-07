import { dowOf, hourOnDate } from '../catalog/hours'
import { addDays, formatInZone } from '../../lib/time'
import type { SchedulePeriod } from './api'

// The Closures form (T17.33). Dates are venue-local "YYYY-MM-DD"; instants are ISO strings.

export type QuickPick = 'today' | 'tomorrow' | 'weekend'

/** The dates a quick pick covers: This weekend is the coming Saturday and Sunday (what is left of it on a weekend). */
export function quickPickDates(pick: QuickPick, today: string): { from: string; to: string } {
  if (pick === 'today') return { from: today, to: today }
  if (pick === 'tomorrow') {
    const tomorrow = addDays(today, 1)
    return { from: tomorrow, to: tomorrow }
  }
  const dow = dowOf(today)
  if (dow === 0) return { from: today, to: today }
  const saturday = addDays(today, 6 - dow)
  return { from: saturday, to: addDays(saturday, 1) }
}

/**
 * A date's whole operating day over the given courts (one array of effective weekly periods per court): from the
 * earliest opening to the latest closing on that weekday, after-midnight hours included. Null when none is open.
 */
export function operatingDayRange(date: string, weekly: SchedulePeriod[][], timeZone: string): { start: string; end: string } | null {
  const dow = dowOf(date)
  const periods = weekly.flat().filter((p) => p.day_of_week === dow)
  if (periods.length === 0) return null
  const start = Math.min(...periods.map((p) => p.start_minute))
  const end = Math.max(...periods.map((p) => p.end_minute))
  return { start: hourOnDate(date, start / 60, timeZone), end: hourOnDate(date, end / 60, timeZone) }
}

const RANGE_END: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }

/** "Thu, Dec 25, 6:00 AM – Fri, Dec 26, 2:00 AM" in the venue zone. */
export function closureRangeText(startIso: string, endIso: string, timeZone: string) {
  const at = (iso: string) => formatInZone(iso, timeZone, RANGE_END)
  return `${at(startIso)} – ${at(endIso)}`
}

/** Every date from `from` to `to`, both included. */
export function datesBetween(from: string, to: string) {
  const dates: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d)
  return dates
}
