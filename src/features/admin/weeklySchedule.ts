import { formatHour } from '../../lib/format'
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
