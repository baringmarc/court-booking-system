// Hotfix: the home page folds the next-7-days public schedule back into short lines (summarizeSchedule).
import { describe, expect, it } from 'vitest'
import type { PublicSchedulePeriod } from './api'
import { summarizeSchedule } from './hours'

const TZ = 'Asia/Manila'
// Monday 2026-11-09 .. Sunday 2026-11-15, then a second week 16..22.
const WEEK = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']
const WEEK2 = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']

/** The instant `hour` hours past the Manila midnight of `date`. */
const at = (date: string, hour: number) => new Date(new Date(`${date}T00:00:00+08:00`).getTime() + hour * 3_600_000).toISOString()

function period(court: string, date: string, open: number, close: number, bookingStart = '2026-11-09', bookingEnd = '2026-11-22'): PublicSchedulePeriod {
  return {
    court_id: court, operating_date: date, period_start: at(date, open), period_end: at(date, close),
    booking_start: bookingStart, booking_end: bookingEnd,
  }
}
const days = (court: string, dates: string[], open: number, close: number, bs?: string, be?: string) =>
  dates.map((d) => period(court, d, open, close, bs, be))

const A = { id: 'a', name: 'Basketball Court' }
const B = { id: 'b', name: 'Pickleball 1' }
const C = { id: 'c', name: 'Tennis Court' }
const D = { id: 'd', name: 'Pickleball 2' }

describe('summarizeSchedule', () => {
  it('all courts 6 AM-10 PM daily collapse to one line', () => {
    const rows = [A, B, C].flatMap((c) => days(c.id, WEEK, 6, 22))
    expect(summarizeSchedule(rows, [A, B, C], TZ)).toEqual(['Open daily, 6 AM – 10 PM'])
  })

  it('weekdays vs weekend', () => {
    const rows = [A, B].flatMap((c) => [...days(c.id, WEEK.slice(0, 5), 6, 22), ...days(c.id, WEEK.slice(5), 8, 20)])
    expect(summarizeSchedule(rows, [A, B], TZ)).toEqual(['Mon–Fri: 6 AM – 10 PM', 'Sat–Sun: 8 AM – 8 PM'])
  })

  it('one court differing gets its own named line after the venue hours', () => {
    const rows = [
      ...days('a', WEEK, 6, 22), ...days('b', WEEK, 6, 22),
      ...days('c', WEEK.slice(0, 5), 6, 22), ...days('c', WEEK.slice(5), 8, 20),
    ]
    expect(summarizeSchedule(rows, [A, B, C], TZ)).toEqual([
      'Open daily, 6 AM – 10 PM',
      'Tennis Court: Mon–Fri: 6 AM – 10 PM · Sat–Sun: 8 AM – 8 PM',
    ])
  })

  it('two courts sharing a different schedule are named together', () => {
    const rows = [...days('a', WEEK, 6, 22), ...days('b', WEEK, 6, 22), ...days('c', WEEK, 6, 22), ...days('d', WEEK, 8, 20)]
    const e = { id: 'e', name: 'Pickleball 3' }
    rows.push(...days('e', WEEK, 8, 20))
    expect(summarizeSchedule(rows, [A, B, C, D, e], TZ)).toEqual([
      'Open daily, 6 AM – 10 PM',
      'Pickleball 2, Pickleball 3: Open daily, 8 AM – 8 PM',
    ])
  })

  it('a break splits the day into several periods', () => {
    const rows = WEEK.flatMap((d) => [period('a', d, 14, 22), period('a', d, 6, 12)]) // out of order on purpose
    expect(summarizeSchedule(rows, [A], TZ)).toEqual(['Open daily, 6 AM – 12 PM, 2 PM – 10 PM'])
  })

  it('an overnight close reads "(next day)"', () => {
    expect(summarizeSchedule(days('a', WEEK, 18, 26), [A], TZ)).toEqual(['Open daily, 6 PM – 2 AM (next day)'])
  })

  it('a close exactly at the next midnight has no "(next day)"', () => {
    expect(summarizeSchedule(days('a', WEEK, 18, 24), [A], TZ)).toEqual(['Open daily, 6 PM – 12 AM'])
  })

  it('24 hours every day', () => {
    expect(summarizeSchedule(days('a', WEEK, 0, 24), [A], TZ)).toEqual(['Open 24 hours, every day'])
  })

  it('one 24-hour day among normal days', () => {
    const rows = [...days('a', WEEK.slice(0, 6), 6, 22), period('a', WEEK[6], 0, 24)]
    expect(summarizeSchedule(rows, [A], TZ)).toEqual(['Mon–Sat: 6 AM – 10 PM', 'Sun: Open 24 hours'])
  })

  it('a date in the window with no rows is Closed', () => {
    const rows = days('a', WEEK.slice(0, 6), 6, 22)
    expect(summarizeSchedule(rows, [A], TZ)).toEqual(['Mon–Sat: 6 AM – 10 PM', 'Sun: Closed'])
  })

  it('rows from the second week are ignored', () => {
    const rows = [...days('a', WEEK, 6, 22), ...days('a', WEEK2, 8, 20)]
    expect(summarizeSchedule(rows, [A], TZ)).toEqual(['Open daily, 6 AM – 10 PM'])
  })

  it('the window is cut at booking_end when sooner than 7 days', () => {
    const rows = days('a', WEEK, 6, 22, '2026-11-09', '2026-11-12')
    expect(summarizeSchedule(rows, [A], TZ)).toEqual(['Mon–Thu: 6 AM – 10 PM'])
  })

  it('weekdays missing from the window break a group', () => {
    // Window Sat 14 .. Tue 17: Mon, Tue, Sat, Sun only; Tue and Sat are not adjacent in the window.
    const rows = days('a', ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17'], 6, 22, '2026-11-14', '2026-11-17')
    expect(summarizeSchedule(rows, [A], TZ)).toEqual(['Mon–Tue: 6 AM – 10 PM', 'Sat–Sun: 6 AM – 10 PM'])
  })

  it('rows for an unknown court_id are ignored', () => {
    const rows = [...days('a', WEEK, 6, 22), ...days('zzz', WEEK, 0, 24)]
    expect(summarizeSchedule(rows, [A], TZ)).toEqual(['Open daily, 6 AM – 10 PM'])
  })

  it('a listed court with no rows is Temporarily closed', () => {
    const rows = days('a', WEEK, 6, 22)
    expect(summarizeSchedule(rows, [A, D], TZ)).toEqual(['Open daily, 6 AM – 10 PM', 'Pickleball 2: Temporarily closed'])
  })

  it('tie between groups: the group whose first court comes first in courts order is the venue hours', () => {
    const rows = [...days('a', WEEK, 6, 22), ...days('b', WEEK, 8, 20)]
    expect(summarizeSchedule(rows, [A, B], TZ)).toEqual(['Open daily, 6 AM – 10 PM', 'Pickleball 1: Open daily, 8 AM – 8 PM'])
    expect(summarizeSchedule(rows, [B, A], TZ)).toEqual(['Open daily, 8 AM – 8 PM', 'Basketball Court: Open daily, 6 AM – 10 PM'])
  })

  it('empty input gives no lines', () => {
    expect(summarizeSchedule([], [A, B], TZ)).toEqual([])
  })
})
