import { DAY_SHORT, DISPLAY_DAY_ORDER, formatHour } from '../../lib/format'
import { addDays, todayInZone, zonedLocalToISO } from '../../lib/time'
import type { PublicSchedulePeriod } from './api'

// Calendar helpers for operating dates (SPEC §5.2). The hours themselves come from the effective schedule
// periods (get_staff_schedule, get_public_schedule), never the legacy weekly hours table (T32.2).

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

/** Whether an instant falls on the calendar day after its operating date (an "after midnight" slot). */
export function isAfterMidnight(iso: string, operatingDate: string, timeZone: string) {
  return todayInZone(timeZone, new Date(iso)) !== operatingDate
}

/** A day's spans as text: "6 AM – 10 PM", "6 AM – 12 PM, 2 PM – 10 PM", "6 PM – 2 AM (next day)", "Open 24 hours" or "Closed". */
export function spansLabel(spans: { open: number; end: number }[]) {
  if (spans.length === 0) return 'Closed'
  if (spans.length === 1 && spans[0].end - spans[0].open === 24) return 'Open 24 hours'
  return spans.map(({ open, end }) => `${formatHour(open)} – ${formatHour(end)}${end > 24 ? ' (next day)' : ''}`).join(', ')
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
