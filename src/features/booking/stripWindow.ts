// The /book date strip (T11.4a): which days it shows and how they're labelled. Dates are venue calendar days
// ("YYYY-MM-DD"), so formatting runs in UTC on the day itself, never on an instant.
import { addDays } from '../../lib/time'

export const STRIP_DAYS = 10

/** Whole days from `from` to `to` (both "YYYY-MM-DD"). */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00Z`) - Date.parse(`${from}T00:00Z`)) / 86_400_000)
}

/** How many tiles the strip has: 10, or fewer when the booking window is shorter. */
export function stripSize(today: string, lastDay: string) {
  return Math.max(1, Math.min(STRIP_DAYS, daysBetween(today, lastDay) + 1))
}

/**
 * The strip's first day after `date` is picked, given where it started before. It moves the least it needs to show
 * `date` (which becomes the last tile going forward, the first going back), never before today or past the last
 * bookable day.
 */
export function stripStart(previous: string, date: string, today: string, lastDay: string) {
  const size = stripSize(today, lastDay)
  let start = previous
  if (date < start) start = date
  else if (daysBetween(start, date) >= size) start = addDays(date, -(size - 1))
  const latest = addDays(lastDay, -(size - 1))
  if (start > latest) start = latest
  if (start < today) start = today
  return start
}

/** The strip's days from its first one. */
export function stripDays(start: string, today: string, lastDay: string) {
  return Array.from({ length: stripSize(today, lastDay) }, (_, i) => addDays(start, i))
}

const fmt = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00Z`))

/** "Oct 2026", "Oct – Nov 2026" or "Dec 2026 – Jan 2027" for the shown days (CSS sets it in capitals). */
export function monthLabel(first: string, last: string) {
  const [m1, y1] = [fmt(first, { month: 'short' }), fmt(first, { year: 'numeric' })]
  const [m2, y2] = [fmt(last, { month: 'short' }), fmt(last, { year: 'numeric' })]
  if (y1 !== y2) return `${m1} ${y1} – ${m2} ${y2}`
  return m1 === m2 ? `${m1} ${y1}` : `${m1} – ${m2} ${y1}`
}

/** The heading's big word: "Today", "Tomorrow" or the weekday. */
export function dayWord(date: string, today: string) {
  if (date === today) return 'Today'
  if (date === addDays(today, 1)) return 'Tomorrow'
  return fmt(date, { weekday: 'long' })
}

/** "Friday, October 30, 2026". */
export const fullDate = (date: string) => fmt(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

/** A tile's parts: "Fri", "30", and its name for screen readers ("Friday, October 30"). */
export function tileParts(date: string) {
  return {
    weekday: fmt(date, { weekday: 'short' }),
    day: fmt(date, { day: 'numeric' }),
    name: fmt(date, { weekday: 'long', month: 'long', day: 'numeric' }),
  }
}

/** Day of the week, 0 = Sunday, for the closed-day rule. */
export const weekdayOf = (date: string) => new Date(`${date}T12:00Z`).getUTCDay()
