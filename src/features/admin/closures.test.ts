// T17.33: the pure helpers behind the Closures form. Dates are venue-local "YYYY-MM-DD"; instants are UTC ISO strings.
// Asia/Manila is UTC+8, so 6 AM local is 22:00 UTC the day before.
import { describe, expect, it } from 'vitest'
import type { SchedulePeriod } from './api'
import { closureRangeText, operatingDayRange, quickPickDates } from './closures'

const TZ = 'Asia/Manila'
const p = (day: number, startHour: number, endHour: number): SchedulePeriod => ({ day_of_week: day, start_minute: startHour * 60, end_minute: endHour * 60 })
const week = (start: number, end: number) => [0, 1, 2, 3, 4, 5, 6].map((d) => p(d, start, end))

describe('quickPickDates (T17.33)', () => {
  // 2030-01-01 is a Tuesday.
  it('Today is today to today and Tomorrow is the next day, on any weekday', () => {
    for (const today of ['2030-01-01', '2030-01-05', '2030-01-06', '2030-12-31']) {
      expect(quickPickDates('today', today)).toEqual({ from: today, to: today })
    }
    expect(quickPickDates('tomorrow', '2030-01-01')).toEqual({ from: '2030-01-02', to: '2030-01-02' })
    expect(quickPickDates('tomorrow', '2030-12-31')).toEqual({ from: '2031-01-01', to: '2031-01-01' })
  })

  it('This weekend is the coming Saturday to Sunday from Monday through Friday', () => {
    const coming = { from: '2030-01-05', to: '2030-01-06' }
    expect(quickPickDates('weekend', '2030-01-01')).toEqual(coming) // Tue
    expect(quickPickDates('weekend', '2030-01-02')).toEqual(coming) // Wed
    expect(quickPickDates('weekend', '2030-01-03')).toEqual(coming) // Thu
    expect(quickPickDates('weekend', '2030-01-04')).toEqual(coming) // Fri
    expect(quickPickDates('weekend', '2029-12-31')).toEqual(coming) // Mon
  })

  it('on a Saturday This weekend is today and tomorrow; on a Sunday it is today only', () => {
    expect(quickPickDates('weekend', '2030-01-05')).toEqual({ from: '2030-01-05', to: '2030-01-06' })
    expect(quickPickDates('weekend', '2030-01-06')).toEqual({ from: '2030-01-06', to: '2030-01-06' })
  })

  it('crosses a month and a year end', () => {
    expect(quickPickDates('weekend', '2030-02-27')).toEqual({ from: '2030-03-02', to: '2030-03-03' })
    expect(quickPickDates('weekend', '2030-12-30')).toEqual({ from: '2031-01-04', to: '2031-01-05' })
  })
})

describe('operatingDayRange (T17.33)', () => {
  // 2030-01-04 is a Friday (day_of_week 5).
  it('is the opening to the closing instant of the date, in the venue zone', () => {
    expect(operatingDayRange('2030-01-04', [week(6, 22)], TZ)).toEqual({ start: '2030-01-03T22:00:00.000Z', end: '2030-01-04T14:00:00.000Z' })
  })

  it('ends on the next calendar date for an overnight operating day (6 PM to 2 AM)', () => {
    const overnight = [{ day_of_week: 5, start_minute: 1080, end_minute: 1560 }]
    expect(operatingDayRange('2030-01-04', [overnight], TZ)).toEqual({ start: '2030-01-04T10:00:00.000Z', end: '2030-01-04T18:00:00.000Z' })
  })

  it('runs from the earliest opening to the latest closing across courts', () => {
    expect(operatingDayRange('2030-01-04', [week(6, 22), week(8, 23)], TZ)).toEqual({ start: '2030-01-03T22:00:00.000Z', end: '2030-01-04T15:00:00.000Z' })
  })

  it('uses the earliest start and latest end across a court\'s breaks, and a court that is closed that weekday adds nothing', () => {
    const split = [p(5, 8, 12), p(5, 14, 20)]
    const closedFriday = [p(1, 6, 22)]
    expect(operatingDayRange('2030-01-04', [split, closedFriday], TZ)).toEqual({ start: '2030-01-04T00:00:00.000Z', end: '2030-01-04T12:00:00.000Z' })
  })

  it('only counts periods of that date\'s weekday', () => {
    expect(operatingDayRange('2030-01-04', [[p(4, 5, 23), p(5, 9, 10)]], TZ)).toEqual({ start: '2030-01-04T01:00:00.000Z', end: '2030-01-04T02:00:00.000Z' })
  })

  it('is null when no court is open that weekday, or there are no courts', () => {
    expect(operatingDayRange('2030-01-04', [[p(1, 6, 22)], [p(2, 6, 22)]], TZ)).toBeNull()
    expect(operatingDayRange('2030-01-04', [[]], TZ)).toBeNull()
    expect(operatingDayRange('2030-01-04', [], TZ)).toBeNull()
  })

  it('covers a 24-hour day, midnight to midnight local', () => {
    expect(operatingDayRange('2030-01-04', [week(0, 24)], TZ)).toEqual({ start: '2030-01-03T16:00:00.000Z', end: '2030-01-04T16:00:00.000Z' })
  })

  it('treats Sunday as day 0 and finds its own periods', () => {
    expect(operatingDayRange('2030-01-06', [[p(0, 7, 21)]], TZ)).toEqual({ start: '2030-01-05T23:00:00.000Z', end: '2030-01-06T13:00:00.000Z' })
  })
})

describe('closureRangeText (T17.33)', () => {
  it('writes weekday, month, day and time for both ends, even across midnight', () => {
    // 6:00 AM Thu Dec 25 to 2:00 AM Fri Dec 26, Manila.
    expect(closureRangeText('2025-12-24T22:00:00.000Z', '2025-12-25T18:00:00.000Z', TZ)).toBe('Thu, Dec 25, 6:00 AM – Fri, Dec 26, 2:00 AM')
  })

  it('shows the venue-local date for an instant that is the previous day in UTC (early morning)', () => {
    expect(closureRangeText('2030-01-03T22:00:00.000Z', '2030-01-04T14:00:00.000Z', TZ)).toBe('Fri, Jan 4, 6:00 AM – Fri, Jan 4, 10:00 PM')
  })

  it('shows a late-night start on its local date', () => {
    expect(closureRangeText('2030-01-04T15:30:00.000Z', '2030-01-04T16:00:00.000Z', TZ)).toBe('Fri, Jan 4, 11:30 PM – Sat, Jan 5, 12:00 AM')
  })
})
