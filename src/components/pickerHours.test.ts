import { describe, expect, it } from 'vitest'
import type { OperatingHours } from '../features/catalog/api'
import {
  calendarEndOptions, calendarHourOptions, closedDaysOfWeek, durationLabel, endAfter, findHour, fromPickerDate, hoursBetween,
  isDateAllowed, maxDuration, operatingHourOptions, toPickerDate,
} from './pickerHours'

const TZ = 'Asia/Manila'

function day(day_of_week: number, open = '06:00:00', close = '22:00:00', is_closed = false): OperatingHours {
  return { day_of_week, open_time: open, close_time: close, is_closed }
}

const week = (fn: (d: number) => OperatingHours) => [0, 1, 2, 3, 4, 5, 6].map(fn)

// 2026-10-24 is a Saturday (day 6).
const SAT = '2026-10-24'

describe('operatingHourOptions', () => {
  it('lists each start hour of a normal day, in the venue zone', () => {
    const options = operatingHourOptions(week((d) => day(d)), SAT, TZ)
    expect(options).toHaveLength(16)
    expect(options[0]).toEqual({ start: '2026-10-23T22:00:00.000Z', label: '6 AM', nextDay: false })
    expect(options.at(-1)).toEqual({ start: '2026-10-24T13:00:00.000Z', label: '9 PM', nextDay: false })
  })

  it('runs an overnight day past midnight and marks those hours', () => {
    const options = operatingHourOptions(week((d) => day(d, '18:00:00', '02:00:00')), SAT, TZ)
    expect(options.map((o) => o.label)).toEqual(['6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM', '12 AM', '1 AM'])
    expect(options.map((o) => o.nextDay)).toEqual([false, false, false, false, false, false, true, true])
    // 12 AM (next day) is Sunday 00:00 in Manila.
    expect(options[6].start).toBe('2026-10-24T16:00:00.000Z')
  })

  it('gives a 24-hour day all 24 hours, none on the next day', () => {
    const options = operatingHourOptions(week((d) => day(d, '00:00:00', '24:00:00')), SAT, TZ)
    expect(options).toHaveLength(24)
    expect(options[0]).toMatchObject({ label: '12 AM', nextDay: false, start: '2026-10-23T16:00:00.000Z' })
    expect(options.at(-1)).toMatchObject({ label: '11 PM', nextDay: false })
  })

  it('has no hours on a closed or missing day', () => {
    expect(operatingHourOptions(week((d) => day(d, undefined, undefined, d === 6)), SAT, TZ)).toEqual([])
    expect(operatingHourOptions([day(1)], SAT, TZ)).toEqual([])
  })

  it('spaces hours exactly one hour apart (Manila has no DST)', () => {
    const options = operatingHourOptions(week((d) => day(d, '06:00:00', '05:00:00')), SAT, TZ)
    expect(options).toHaveLength(23)
    for (let i = 1; i < options.length; i++) expect(hoursBetween(options[i - 1].start, options[i].start)).toBe(1)
  })
})

describe('calendarHourOptions', () => {
  it('lists the 24 hours of the calendar date', () => {
    const options = calendarHourOptions(SAT, TZ)
    expect(options).toHaveLength(24)
    expect(options[0]).toEqual({ start: '2026-10-23T16:00:00.000Z', label: '12 AM', nextDay: false })
    expect(options[13].label).toBe('1 PM')
  })
})

describe('calendarEndOptions', () => {
  it('ends at 1 AM through midnight, the end of the date', () => {
    const options = calendarEndOptions(SAT, TZ)
    expect(options).toHaveLength(24)
    expect(options[0]).toEqual({ start: '2026-10-23T17:00:00.000Z', label: '1 AM', nextDay: false })
    expect(options.at(-1)).toEqual({ start: '2026-10-24T16:00:00.000Z', label: 'Midnight', nextDay: false })
  })
})

describe('findHour and maxDuration', () => {
  const options = operatingHourOptions(week((d) => day(d, '18:00:00', '02:00:00')), SAT, TZ)

  it('matches a start written by the server ("+00:00") to its option', () => {
    expect(findHour(options, '2026-10-24T16:00:00+00:00')?.label).toBe('12 AM')
    expect(findHour(options, null)).toBeUndefined()
    expect(findHour(options, '2026-10-24T03:00:00Z')).toBeUndefined()
  })

  it('allows hours up to the end of the operating day, across midnight', () => {
    expect(maxDuration(options, options[0].start)).toBe(8)
    expect(maxDuration(options, options[5].start)).toBe(3) // 11 PM → until 2 AM
    expect(maxDuration(options, options.at(-1)!.start)).toBe(1)
  })

  it('allows nothing for a start that is not one of the options', () => {
    expect(maxDuration(options, null)).toBe(0)
    expect(maxDuration(options, '2026-10-24T03:00:00Z')).toBe(0)
  })
})

describe('endAfter and hoursBetween', () => {
  it('adds elapsed hours, across midnight', () => {
    expect(endAfter('2026-10-24T15:00:00.000Z', 3)).toBe('2026-10-24T18:00:00.000Z')
    expect(hoursBetween('2026-10-24T15:00:00.000Z', '2026-10-24T18:00:00+00:00')).toBe(3)
  })
})

describe('closedDaysOfWeek', () => {
  it('lists closed and missing days', () => {
    expect(closedDaysOfWeek(week((d) => day(d, undefined, undefined, d === 1)))).toEqual([1])
    expect(closedDaysOfWeek([day(1), day(2)])).toEqual([0, 3, 4, 5, 6])
  })

  it('treats an overnight day as open', () => {
    expect(closedDaysOfWeek(week((d) => day(d, '18:00:00', '02:00:00')))).toEqual([])
  })
})

describe('picker dates', () => {
  it('round-trips a date through the calendar Date', () => {
    expect(fromPickerDate(toPickerDate('2026-01-05'))).toBe('2026-01-05')
    expect(fromPickerDate(toPickerDate('2026-12-31'))).toBe('2026-12-31')
    expect(toPickerDate('2026-10-24').getDay()).toBe(6)
  })

  it('allows a date only inside the range and on open days', () => {
    const rules = { min: '2026-10-24', max: '2026-10-31', closedDays: [1] }
    expect(isDateAllowed('2026-10-24', rules)).toBe(true)
    expect(isDateAllowed('2026-10-23', rules)).toBe(false)
    expect(isDateAllowed('2026-11-01', rules)).toBe(false)
    expect(isDateAllowed('2026-10-26', rules)).toBe(false) // a Monday
    expect(isDateAllowed('2020-01-01', {})).toBe(true)
  })
})

describe('durationLabel', () => {
  it('pluralizes', () => {
    expect(durationLabel(1)).toBe('1 hr')
    expect(durationLabel(3)).toBe('3 hrs')
  })
})
