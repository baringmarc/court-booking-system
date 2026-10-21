import { describe, expect, it } from 'vitest'
import type { OperatingHours } from './api'
import { daySpan, dowOf, findOverlap, isAfterMidnight, isAllDay, isOvernight, operatingDateOf, operatingDayRange, operatingToday, overlapMessage, summarizeHours } from './hours'

function day(day_of_week: number, open = '06:00:00', close = '22:00:00', is_closed = false): OperatingHours {
  return { day_of_week, open_time: open, close_time: close, is_closed }
}

const week = (fn: (d: number) => OperatingHours) => [0, 1, 2, 3, 4, 5, 6].map(fn)

describe('summarizeHours', () => {
  it('collapses identical days into one line', () => {
    expect(summarizeHours(week((d) => day(d)))).toEqual(['Open daily, 6 AM – 10 PM'])
  })

  it('reports a fully closed week', () => {
    expect(summarizeHours(week((d) => day(d, undefined, undefined, true)))).toEqual(['Temporarily closed'])
  })

  it('groups weekdays and weekends, Monday first', () => {
    const hours = week((d) => (d === 0 || d === 6 ? day(d, '08:00:00', '20:00:00') : day(d)))
    expect(summarizeHours(hours)).toEqual(['Mon–Fri: 6 AM – 10 PM', 'Sat–Sun: 8 AM – 8 PM'])
  })

  it('does not merge non-adjacent days with the same hours', () => {
    const hours = week((d) => day(d, undefined, undefined, d === 0 || d === 1))
    expect(summarizeHours(hours)).toEqual(['Mon: Closed', 'Tue–Sat: 6 AM – 10 PM', 'Sun: Closed'])
  })

  it('treats a missing day as closed', () => {
    const hours = week((d) => day(d)).filter((h) => h.day_of_week !== 0)
    expect(summarizeHours(hours)).toEqual(['Mon–Sat: 6 AM – 10 PM', 'Sun: Closed'])
  })
})

describe('summarizeHours with overnight and 24-hour days', () => {
  it('marks a close after midnight as the next day', () => {
    expect(summarizeHours(week((d) => day(d, '06:00:00', '05:00:00')))).toEqual(['Open daily, 6 AM – 5 AM (next day)'])
  })

  it('says open 24 hours for open = close', () => {
    expect(summarizeHours(week((d) => day(d, '06:00:00', '06:00:00')))).toEqual(['Open 24 hours, every day'])
    const hours = week((d) => (d === 5 || d === 6 ? day(d, '06:00:00', '06:00:00') : day(d)))
    expect(summarizeHours(hours)).toEqual(['Mon–Thu: 6 AM – 10 PM', 'Fri–Sat: Open 24 hours', 'Sun: 6 AM – 10 PM'])
  })

  it('keeps a midnight close on the same day', () => {
    expect(summarizeHours(week((d) => day(d, '18:00:00', '24:00:00')))).toEqual(['Open daily, 6 PM – 12 AM'])
  })
})

describe('operating day helpers', () => {
  it('measures a day in hours past its own midnight', () => {
    expect(daySpan(day(1))).toEqual({ open: 6, end: 22 })
    expect(daySpan(day(1, '06:00:00', '05:00:00'))).toEqual({ open: 6, end: 29 })
    expect(daySpan(day(1, '06:00:00', '06:00:00'))).toEqual({ open: 6, end: 30 })
    expect(daySpan(day(1, '18:00:00', '24:00:00'))).toEqual({ open: 18, end: 24 })
    expect(daySpan(day(1, undefined, undefined, true))).toBeNull()
    expect(isOvernight(day(1, '06:00:00', '05:00:00'))).toBe(true)
    expect(isOvernight(day(1, '18:00:00', '24:00:00'))).toBe(false)
    expect(isAllDay(day(1, '06:00:00', '06:00:00'))).toBe(true)
    expect(isAllDay(day(1, '00:00:00', '24:00:00'))).toBe(true)
  })

  it('finds a day that runs into the next day\'s opening, like the database', () => {
    expect(findOverlap(week((d) => day(d)))).toBeNull()
    // Monday 08:00 → 06:00 Tuesday fits exactly; → 07:00 overlaps Tuesday's 06:00 opening.
    expect(findOverlap(week((d) => (d === 1 ? day(d, '08:00:00', '06:00:00') : day(d))))).toBeNull()
    const clash = findOverlap(week((d) => (d === 1 ? day(d, '08:00:00', '07:00:00') : day(d))))
    expect(clash).toEqual({ day: 1, next: 2 })
    expect(overlapMessage(clash!)).toBe("Monday runs past Tuesday's opening time. Close earlier, or open Tuesday later.")
    // Saturday into Sunday wraps around the week; a closed next day never clashes.
    expect(findOverlap(week((d) => (d === 6 ? day(d, '08:00:00', '07:00:00') : day(d))))).toEqual({ day: 6, next: 0 })
    expect(findOverlap(week((d) => (d === 6 ? day(d, '08:00:00', '07:00:00') : d === 0 ? day(d, undefined, undefined, true) : day(d))))).toBeNull()
  })

  // 2030-01-08 is a Tuesday; Manila is UTC+8.
  const manila = (local: string) => new Date(`${local}+08:00`)

  it('takes today to be the operating day running now', () => {
    const overnightMonday = week((d) => (d === 1 ? day(d, '06:00:00', '05:00:00') : day(d)))
    expect(operatingToday(overnightMonday, 'Asia/Manila', manila('2030-01-08T01:30'))).toBe('2030-01-07') // Monday night
    expect(operatingToday(overnightMonday, 'Asia/Manila', manila('2030-01-08T05:30'))).toBe('2030-01-08') // closed: local date
    expect(operatingToday(overnightMonday, 'Asia/Manila', manila('2030-01-08T06:00'))).toBe('2030-01-08') // Tuesday opens
    expect(operatingToday(week((d) => day(d)), 'Asia/Manila', manila('2030-01-08T01:30'))).toBe('2030-01-08') // normal hours
  })

  it('tells after-midnight slots apart from the operating date', () => {
    expect(isAfterMidnight(manila('2030-01-07T23:00').toISOString(), '2030-01-07', 'Asia/Manila')).toBe(false)
    expect(isAfterMidnight(manila('2030-01-08T01:00').toISOString(), '2030-01-07', 'Asia/Manila')).toBe(true)
  })

  it('gives an operating date\'s open instants, past midnight for an overnight day', () => {
    const overnightMonday = week((d) => (d === 1 ? day(d, '06:00:00', '05:00:00') : day(d)))
    expect(dowOf('2030-01-07')).toBe(1)
    expect(operatingDayRange(overnightMonday, '2030-01-07', 'Asia/Manila')).toEqual({
      start: manila('2030-01-07T06:00').toISOString(), end: manila('2030-01-08T05:00').toISOString(),
    })
    expect(operatingDayRange(overnightMonday, '2030-01-08', 'Asia/Manila')).toEqual({
      start: manila('2030-01-08T06:00').toISOString(), end: manila('2030-01-08T22:00').toISOString(),
    })
    expect(operatingDayRange(week((d) => day(d, undefined, undefined, true)), '2030-01-07', 'Asia/Manila')).toBeNull()
  })

  it("finds a slot's operating date (checkout looks its run up there)", () => {
    const overnightMonday = week((d) => (d === 1 ? day(d, '06:00:00', '05:00:00') : day(d)))
    expect(operatingDateOf(overnightMonday, 'Asia/Manila', manila('2030-01-08T01:00'))).toBe('2030-01-07')
    expect(operatingDateOf(overnightMonday, 'Asia/Manila', manila('2030-01-07T23:00'))).toBe('2030-01-07')
    expect(operatingDateOf(overnightMonday, 'Asia/Manila', manila('2030-01-08T10:00'))).toBe('2030-01-08')
  })
})
