// Pure helpers for the date, hour and duration pickers (T10.2, RESEARCH M10). Dates are venue-local "YYYY-MM-DD"
// strings and hours are ISO instants; the zone conversion goes through lib/time.ts (via catalog/hours). They live
// here, not in lib/, because they build on the operating-day rules in features/catalog/hours.ts.
import type { OperatingHours } from '../features/catalog/api'
import { daySpan, dowOf, hourOnDate } from '../features/catalog/hours'
import { formatHour } from '../lib/format'

type Hours = Pick<OperatingHours, 'day_of_week' | 'open_time' | 'close_time' | 'is_closed'>

/** One hour button: its start instant, "6 AM", and whether it falls on the calendar day after `date`. */
export type HourOption = { start: string; label: string; nextDay: boolean }

function option(date: string, hour: number, timeZone: string): HourOption {
  return { start: hourOnDate(date, hour, timeZone), label: formatHour(hour), nextDay: hour >= 24 }
}

/** The start hours of one operating day, overnight ones included ("12 AM (next day)"); none when it's closed. */
export function operatingHourOptions(hours: Hours[], date: string, timeZone: string): HourOption[] {
  const span = daySpan(hours.find((h) => h.day_of_week === dowOf(date)))
  if (!span) return []
  const options: HourOption[] = []
  for (let hour = span.open; hour < span.end; hour++) options.push(option(date, hour, timeZone))
  return options
}

/** All 24 hours of a calendar date, for times that may fall outside opening hours (blackouts). */
export function calendarHourOptions(date: string, timeZone: string): HourOption[] {
  return Array.from({ length: 24 }, (_, hour) => option(date, hour, timeZone))
}

/** The option starting at `start`, compared as instants (the server writes "+00:00", the client "Z"). */
export function findHour(options: HourOption[], start: string | null) {
  if (!start) return undefined
  const at = Date.parse(start)
  return options.find((o) => Date.parse(o.start) === at)
}

/** How many hours can follow `start` within these options: 1 up to the end of the day; none for an unknown start. */
export function maxDuration(options: HourOption[], start: string | null) {
  const found = findHour(options, start)
  return found ? options.length - options.indexOf(found) : 0
}

/** The end of a run of `hours` hours from `start` (elapsed time, so it's right across midnight). */
export function endAfter(start: string, hours: number) {
  return new Date(Date.parse(start) + hours * 3_600_000).toISOString()
}

/** Whole hours from `start` to `end`. */
export function hoursBetween(start: string, end: string) {
  return Math.round((Date.parse(end) - Date.parse(start)) / 3_600_000)
}

/** Days of the week (0 = Sunday) the venue is closed all day, for the calendar's disabled days. */
export function closedDaysOfWeek(hours: Hours[]) {
  return [0, 1, 2, 3, 4, 5, 6].filter((day) => !daySpan(hours.find((h) => h.day_of_week === day)))
}

/** "YYYY-MM-DD" → a local Date at midnight, for the calendar (it works in calendar days, never instants). */
export function toPickerDate(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** The calendar's local Date → "YYYY-MM-DD". */
export function fromPickerDate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Whether a date is pickable: inside [min, max] (either may be open) and not on a closed day. */
export function isDateAllowed(date: string, { min, max, closedDays = [] }: { min?: string; max?: string; closedDays?: number[] }) {
  return (!min || date >= min) && (!max || date <= max) && !closedDays.includes(dowOf(date))
}

/** "1 hr", "2 hrs". */
export function durationLabel(hours: number) {
  return `${hours} ${hours === 1 ? 'hr' : 'hrs'}`
}
