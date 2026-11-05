import { DAY_NAMES, DAY_SHORT, DISPLAY_DAY_ORDER, formatHour, hourOf } from '../../lib/format'
import { addDays, localHoursInZone, todayInZone, zonedLocalToISO } from '../../lib/time'
import type { OperatingHours, PublicSchedulePeriod } from './api'

// Operating days (SPEC §5.2, T9.9/T9.10). These mirror the SQL helpers in 20261021001821_overnight_hours.sql:
// a close before the open means the next day, 24 hours is 12 AM to midnight (an open day can't close at its opening
// time), and a slot belongs to the day whose opening it follows.

type Hours = Pick<OperatingHours, 'day_of_week' | 'open_time' | 'close_time' | 'is_closed'>

/** A day's open span in hours past its own midnight: [open, end), end past 24 when it runs into the next day. */
export function daySpan(h: Hours | undefined): { open: number; end: number } | null {
  if (!h || h.is_closed) return null
  const open = hourOf(h.open_time)
  const close = hourOf(h.close_time)
  return { open, end: close <= open ? close + 24 : close }
}

export const isOvernight = (h: Hours | undefined) => (daySpan(h)?.end ?? 0) > 24
export const isAllDay = (h: Hours | undefined) => {
  const span = daySpan(h)
  return !!span && span.open === 0 && span.end === 24
}

/** The first open day (in display order) that closes at its opening time, which the database refuses, or null. */
export function findSameTime(hours: Hours[]): number | null {
  const same = (h: Hours) => !h.is_closed && hourOf(h.open_time) === hourOf(h.close_time)
  return DISPLAY_DAY_ORDER.find((d) => hours.some((h) => h.day_of_week === d && same(h))) ?? null
}

export function sameTimeMessage(day: number) {
  return `${DAY_NAMES[day]} opens and closes at the same time. For 24 hours, open at 12 AM and close at midnight.`
}

/** The first day that runs past the next day's opening (the database refuses it: hours_overlap), or null. */
export function findOverlap(hours: Hours[]): { day: number; next: number } | null {
  const byDay = new Map(hours.map((h) => [h.day_of_week, h]))
  for (let day = 0; day < 7; day++) {
    const span = daySpan(byDay.get(day))
    const next = (day + 1) % 7
    const nextSpan = daySpan(byDay.get(next))
    if (span && nextSpan && span.end > 24 + nextSpan.open) return { day, next }
  }
  return null
}

export function overlapMessage({ day, next }: { day: number; next: number }) {
  return `${DAY_NAMES[day]} runs past ${DAY_NAMES[next]}'s opening time. Close earlier, or open ${DAY_NAMES[next]} later.`
}

/** Day of week (0 = Sunday) of a "YYYY-MM-DD" date. */
export const dowOf = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** The instant `hour` hours past local midnight of `date` (24 and up land on the following days). */
export function hourOnDate(date: string, hour: number, timeZone: string) {
  const day = addDays(date, Math.floor(hour / 24))
  return zonedLocalToISO(`${day}T${String(hour % 24).padStart(2, '0')}:00`, timeZone)
}

/** The instants an operating date is open, as ISO strings, or null when it's closed. Same as operating_day_range. */
export function operatingDayRange(hours: Hours[], date: string, timeZone: string): { start: string; end: string } | null {
  const span = daySpan(hours.find((h) => h.day_of_week === dowOf(date)))
  if (!span) return null
  return { start: hourOnDate(date, span.open, timeZone), end: hourOnDate(date, span.end, timeZone) }
}

/**
 * The operating date an instant belongs to: its local date when that day is open then, else the previous date
 * when that day runs past midnight to then, else (closed) the local date. Same rule as
 * private.operating_day_of(), with the local date as the closed fallback like operating_today().
 */
export function operatingDateOf(hours: Hours[], timeZone: string, instant: Date): string {
  const now = instant
  const local = todayInZone(timeZone, now)
  const at = localHoursInZone(now, timeZone)
  const byDay = new Map(hours.map((h) => [h.day_of_week, h]))
  const todaySpan = daySpan(byDay.get(dowOf(local)))
  if (todaySpan && at >= todaySpan.open && at < todaySpan.end) return local
  const yesterday = addDays(local, -1)
  const yesterdaySpan = daySpan(byDay.get(dowOf(yesterday)))
  if (yesterdaySpan && at + 24 >= yesterdaySpan.open && at + 24 < yesterdaySpan.end) return yesterday
  return local
}

/**
 * "Today" for the venue (the walk-in form, the dashboard, /book's first date): the operating day running now,
 * so at 1 AM after a 6 AM–5 AM day it's yesterday's date. Same rule as private.operating_today().
 */
export function operatingToday(hours: Hours[], timeZone: string, now = new Date()): string {
  return operatingDateOf(hours, timeZone, now)
}

/** Whether an instant falls on the calendar day after its operating date (an "after midnight" slot). */
export function isAfterMidnight(iso: string, operatingDate: string, timeZone: string) {
  return todayInZone(timeZone, new Date(iso)) !== operatingDate
}

/** A day's spans as text: "6 AM – 10 PM", "6 AM – 12 PM, 2 PM – 10 PM", "6 PM – 2 AM (next day)", "Open 24 hours" or "Closed". */
function spansLabel(spans: { open: number; end: number }[]) {
  if (spans.length === 0) return 'Closed'
  if (spans.length === 1 && spans[0].end - spans[0].open === 24) return 'Open 24 hours'
  return spans.map(({ open, end }) => `${formatHour(open)} – ${formatHour(end)}${end > 24 ? ' (next day)' : ''}`).join(', ')
}

const label = (h: Hours | undefined) => {
  const span = daySpan(h)
  return spansLabel(span ? [span] : [])
}

/** "Open daily, 6 AM – 10 PM" or grouped lines like "Mon–Fri: 6 AM – 10 PM", "Sun: Closed". */
export function summarizeHours(hours: OperatingHours[]): string[] {
  const byDay = new Map(hours.map((h) => [h.day_of_week, h]))
  return summarizeDays(new Map(DISPLAY_DAY_ORDER.map((day) => [day, label(byDay.get(day))])))
}

/**
 * The next week of the public schedule (`get_public_schedule`) in a few lines: the hours most courts share, unnamed,
 * then one line per group of courts with other hours ("Tennis Court: Mon–Fri: 6 AM – 10 PM · Sat–Sun: 8 AM – 8 PM").
 * The week is the 7 operating dates from the first bookable date, cut at the last one; a date without periods is Closed.
 */
export function summarizeSchedule(periods: PublicSchedulePeriod[], courts: { id: string; name: string }[], timeZone: string): string[] {
  if (periods.length === 0) return []
  const first = periods.map((p) => p.booking_start).sort()[0]
  const lastBookable = periods.map((p) => p.booking_end).sort().at(-1)!
  const dates = Array.from({ length: 7 }, (_, i) => addDays(first, i)).filter((date) => date <= lastBookable)

  const hoursPast = (iso: string, midnight: string) => (new Date(iso).getTime() - new Date(midnight).getTime()) / 3_600_000
  const summaries = courts.map((court) => {
    const texts = new Map<number, string>()
    for (const date of dates) {
      const midnight = hourOnDate(date, 0, timeZone)
      const spans = periods
        .filter((p) => p.court_id === court.id && p.operating_date === date)
        .map((p) => ({ open: hoursPast(p.period_start, midnight), end: hoursPast(p.period_end, midnight) }))
        .sort((a, b) => a.open - b.open)
      texts.set(dowOf(date), spansLabel(spans))
    }
    return summarizeDays(texts)
  })

  // Courts with the same lines share a group, in courts order; the largest (first on a tie) is the venue's hours.
  const groups: { names: string[]; lines: string[] }[] = []
  courts.forEach((court, i) => {
    const key = summaries[i].join('\n')
    const group = groups.find((g) => g.lines.join('\n') === key)
    if (group) group.names.push(court.name)
    else groups.push({ names: [court.name], lines: summaries[i] })
  })
  const main = groups.reduce((best, g) => (g.names.length > best.names.length ? g : best), groups[0])
  if (!main) return []
  return [...main.lines, ...groups.filter((g) => g !== main).map((g) => `${g.names.join(', ')}: ${g.lines.join(' · ')}`)]
}

/** Weekday texts (only the days present) in display order: consecutive equal days merge; a missing day breaks a run. */
function summarizeDays(texts: Map<number, string>): string[] {
  const groups: { days: number[]; text: string }[] = []
  let previous: number | null = null
  for (const day of DISPLAY_DAY_ORDER) {
    const text = texts.get(day)
    if (text === undefined) { previous = null; continue }
    const last = groups.at(-1)
    if (last && previous !== null && last.text === text) last.days.push(day)
    else groups.push({ days: [day], text })
    previous = day
  }

  if (groups.length === 1 && groups[0].days.length === 7) {
    const text = groups[0].text
    if (text === 'Closed') return ['Temporarily closed']
    return [text === 'Open 24 hours' ? 'Open 24 hours, every day' : `Open daily, ${text}`]
  }
  return groups.map(({ days, text }) => {
    const first = DAY_SHORT[days[0]]
    const span = days.length === 1 ? first : `${first}–${DAY_SHORT[days.at(-1)!]}`
    return `${span}: ${text}`
  })
}
