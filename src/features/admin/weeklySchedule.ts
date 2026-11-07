import { DAY_NAMES, DAY_SHORT, DISPLAY_DAY_ORDER, formatHour } from '../../lib/format'
import type { SchedulePeriod } from './api'

// Whole-hour periods per weekday (T17.15). Minutes run from the operating day's midnight; an end past 24 h belongs to
// the next calendar day. The database allows 24 h at most per period and refuses overlaps across weekdays, Sunday
// wrapping to Monday included. Touching periods are allowed and never merged.

export const hourOfMinute = (minute: number) => Math.round(minute / 60)

/** The latest close offered for an opening hour: a full day only as 12 AM to midnight (open and close can't match). */
export const maxEnd = (start: number) => (start === 0 ? 24 : start + 23)

export const closeHours = (start: number) => Array.from({ length: maxEnd(start) - start }, (_, i) => start + 1 + i)

/** "Midnight" for 24, "2 AM (next day)" past it. */
export function hourLabel(hour: number) {
  if (hour === 24) return 'Midnight'
  return hour > 24 ? `${formatHour(hour)} (next day)` : formatHour(hour)
}

export const periodsOfDay = (periods: SchedulePeriod[], day: number) => periods.filter((p) => p.day_of_week === day)

const normalised = (periods: SchedulePeriod[]) =>
  periods
    .map(({ day_of_week, start_minute, end_minute }) => ({ day_of_week, start_minute, end_minute }))
    .sort((a, b) => a.day_of_week - b.day_of_week || a.start_minute - b.start_minute || a.end_minute - b.end_minute)

export const toSave = normalised

export function samePeriods(a: SchedulePeriod[], b: SchedulePeriod[]) {
  return JSON.stringify(normalised(a)) === JSON.stringify(normalised(b))
}

export function changedDays(draft: SchedulePeriod[], saved: SchedulePeriod[]) {
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => !samePeriods(periodsOfDay(draft, d), periodsOfDay(saved, d)))
}

const WEEK = 7 * 1440

/** Weekdays holding a period that truly overlaps another, across the week's Sunday→Monday wrap. Touching is fine. */
export function overlapDays(periods: SchedulePeriod[]) {
  const days = new Set<number>()
  periods.forEach((a, i) => {
    for (let j = i + 1; j < periods.length; j++) {
      const b = periods[j]
      const as = a.day_of_week * 1440 + a.start_minute
      const ae = a.day_of_week * 1440 + a.end_minute
      const clash = [-WEEK, 0, WEEK].some((shift) => {
        const bs = b.day_of_week * 1440 + b.start_minute + shift
        const be = b.day_of_week * 1440 + b.end_minute + shift
        return as < be && bs < ae
      })
      if (clash) {
        days.add(a.day_of_week)
        days.add(b.day_of_week)
      }
    }
  })
  return days
}

/** Closed stretches between a day's open periods, as [from, to) hours. */
export function gaps(periods: SchedulePeriod[]) {
  const sorted = [...periods].sort((a, b) => a.start_minute - b.start_minute)
  const out: [number, number][] = []
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start_minute > sorted[i - 1].end_minute) {
      out.push([hourOfMinute(sorted[i - 1].end_minute), hourOfMinute(sorted[i].start_minute)])
    }
  }
  return out
}

export const periodText = (p: SchedulePeriod) => `${hourLabel(hourOfMinute(p.start_minute))} to ${hourLabel(hourOfMinute(p.end_minute))}`

// --- the opening hours table and week chart (T17.32) -------------------------

const byStart = (periods: SchedulePeriod[]) => [...periods].sort((a, b) => a.start_minute - b.start_minute || a.end_minute - b.end_minute)
const period = (day: number, start: number, end: number): SchedulePeriod => ({ day_of_week: day, start_minute: start * 60, end_minute: end * 60 })

/** A day's periods in start order. */
export const daySorted = (periods: SchedulePeriod[], day: number) => byStart(periodsOfDay(periods, day))

/** Replaces one day's periods, leaving the other days as they were. */
export const withDay = (periods: SchedulePeriod[], day: number, next: SchedulePeriod[]) =>
  [...periods.filter((p) => p.day_of_week !== day), ...next]

/**
 * Splits the day's longest range around a closed break: 2 hours where the range is 6 hours or more (6 AM – 10 PM gives
 * 12 PM – 2 PM), else 1 hour. The day keeps its opening and closing; a closed day or one shorter than 3 hours is unchanged.
 */
export function addBreak(periods: SchedulePeriod[], day: number) {
  const mine = daySorted(periods, day)
  if (mine.length === 0) return periods
  const longest = mine.reduce((a, b) => (b.end_minute - b.start_minute > a.end_minute - a.start_minute ? b : a))
  const start = hourOfMinute(longest.start_minute)
  const end = hourOfMinute(longest.end_minute)
  const length = end - start
  if (length < 3) return periods
  const breakEnd = start + Math.ceil(length / 2)
  const breakStart = breakEnd - (length >= 6 ? 2 : 1)
  return withDay(periods, day, mine.flatMap((p) => (p === longest ? [period(day, start, breakStart), period(day, breakEnd, end)] : [p])))
}

/** Joins the two ranges around the day's `gapIndex`-th break (0-based, in time order). */
export function removeBreak(periods: SchedulePeriod[], day: number, gapIndex: number) {
  const mine = daySorted(periods, day)
  const [a, b] = [mine[gapIndex], mine[gapIndex + 1]]
  if (!a || !b) return periods
  const joined = { day_of_week: day, start_minute: a.start_minute, end_minute: b.end_minute }
  return withDay(periods, day, [...mine.slice(0, gapIndex), joined, ...mine.slice(gapIndex + 2)])
}

/** Closing drops the day; opening brings back its saved periods, or 6 AM – 10 PM if it was never open. */
export function setDayOpen(periods: SchedulePeriod[], day: number, open: boolean, saved: SchedulePeriod[]) {
  if (!open) return withDay(periods, day, [])
  if (periodsOfDay(periods, day).length > 0) return periods
  const was = periodsOfDay(saved, day).map(({ day_of_week, start_minute, end_minute }) => ({ day_of_week, start_minute, end_minute }))
  return withDay(periods, day, was.length ? was : [period(day, 6, 22)])
}

/** The day's overlaps in plain words, naming both days, or null. Sunday's after-midnight hours run into Monday. */
export function overlapMessage(periods: SchedulePeriod[], day: number): string | null {
  const mine = periodsOfDay(periods, day)
  const clashes = new Set<number>()
  for (const a of mine) {
    for (const b of periods) {
      if (a === b) continue
      const as = a.day_of_week * 1440 + a.start_minute
      const ae = a.day_of_week * 1440 + a.end_minute
      const hit = [-WEEK, 0, WEEK].some((shift) => {
        const bs = b.day_of_week * 1440 + b.start_minute + shift
        return as < b.day_of_week * 1440 + b.end_minute + shift && bs < ae
      })
      if (hit) clashes.add(b.day_of_week)
    }
  }
  if (clashes.size === 0) return null
  const name = DAY_NAMES[day]
  if (clashes.has(day)) return `${name}'s opening hours overlap each other. Change them so one ends before the next starts.`
  const other = [...clashes][0]
  // The earlier day is the one whose hours run past midnight (Saturday into Sunday, Sunday into Monday).
  const [first, second] = (day + 1) % 7 === other ? [name, DAY_NAMES[other]] : [DAY_NAMES[other], name]
  return `${first}'s hours run past midnight and overlap ${second}'s opening. Close ${first} earlier or open ${second} later.`
}

/** The hours the week chart spans: the week's earliest opening to its latest closing (past 24 after midnight). */
export function chartAxis(periods: SchedulePeriod[]) {
  if (periods.length === 0) return { from: 6, to: 22 }
  return {
    from: Math.min(...periods.map((p) => hourOfMinute(p.start_minute))),
    to: Math.max(...periods.map((p) => hourOfMinute(p.end_minute))),
  }
}

/** A day in words for screen readers: "Monday: open 6 AM to 12 PM and 2 PM to 10 PM", "Monday: closed". */
export function chartDayText(periods: SchedulePeriod[], day: number) {
  const mine = daySorted(periods, day)
  const name = DAY_NAMES[day]
  if (mine.length === 0) return `${name}: closed`
  if (mine.length === 1 && mine[0].start_minute === 0 && mine[0].end_minute === 1440) return `${name}: open 24 hours`
  const ranges = mine.map(periodText)
  const words = ranges.length === 1 ? ranges[0] : `${ranges.slice(0, -1).join(', ')} and ${ranges.at(-1)}`
  return `${name}: open ${words}`
}

/** A day's periods in start order for the Review changes list: "6 AM – 12 PM, 2 PM – 10 PM", or "Closed" (T17.31). */
export const dayText = (periods: SchedulePeriod[]) => periods.length === 0 ? 'Closed' : [...periods]
  .sort((a, b) => a.start_minute - b.start_minute)
  .map((p) => `${hourLabel(hourOfMinute(p.start_minute))} – ${hourLabel(hourOfMinute(p.end_minute))}`)
  .join(', ')

// --- override rate summary (T17.33) ------------------------------------------

export type RateRun = { days: number[]; start_hour: number; end_hour: number; price: number }

/**
 * Override rates as runs: per day, consecutive hours of one price join into one run (`end_hour` exclusive); days whose
 * runs are all the same join into one group. Flat, one entry per run of each group, ordered by the group's first day
 * (Monday first) and then start hour.
 */
export function rateRuns(rates: { day_of_week: number; start_hour: number; price: number }[]): RateRun[] {
  const groups: { days: number[]; runs: Omit<RateRun, 'days'>[]; key: string }[] = []
  for (const day of DISPLAY_DAY_ORDER) {
    const hours = rates.filter((r) => r.day_of_week === day).sort((a, b) => a.start_hour - b.start_hour)
    const runs: Omit<RateRun, 'days'>[] = []
    for (const { start_hour, price } of hours) {
      const last = runs.at(-1)
      if (last && last.end_hour === start_hour && last.price === price) last.end_hour = start_hour + 1
      else runs.push({ start_hour, end_hour: start_hour + 1, price })
    }
    if (runs.length === 0) continue
    const key = JSON.stringify(runs)
    const same = groups.find((g) => g.key === key)
    if (same) same.days.push(day)
    else groups.push({ days: [day], runs, key })
  }
  return groups.flatMap(({ days, runs }) => runs.map((run) => ({ days, ...run })))
}

/** "Every day", "Mon–Fri" (3+ days in a row), "Sat & Sun" (two days), "Monday" (one), else "Mon, Wed, Fri". */
export function dayGroupLabel(days: number[]) {
  if (days.length === 7) return 'Every day'
  if (days.length === 1) return DAY_NAMES[days[0]]
  const short = days.map((d) => DAY_SHORT[d])
  if (days.length === 2) return short.join(' & ')
  const at = days.map((d) => DISPLAY_DAY_ORDER.indexOf(d))
  const inARow = at.every((pos, i) => i === 0 || pos === at[i - 1] + 1)
  return inARow ? `${short[0]}–${short.at(-1)}` : short.join(', ')
}

/** "5 PM – 10 PM", "6 AM – Midnight". */
export const rateRunText = ({ start_hour, end_hour }: { start_hour: number; end_hour: number }) =>
  `${hourLabel(start_hour)} – ${hourLabel(end_hour)}`
