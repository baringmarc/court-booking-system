import { describe, expect, it } from 'vitest'
import { hourOnDate } from '../features/catalog/hours'
import { formatHour } from '../lib/format'
import {
  calendarEndOptions, calendarHourOptions, durationLabel, endAfter, findHour, fromPickerDate, hoursBetween,
  isDateAllowed, maxDuration, toPickerDate, type HourOption,
} from './pickerHours'

const TZ = 'Asia/Manila'

// 2026-10-24 is a Saturday (day 6).
const SAT = '2026-10-24'

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
  // One overnight operating day, 6 PM to 2 AM (8 start hours).
  const options: HourOption[] = [18, 19, 20, 21, 22, 23, 24, 25].map((hour) => ({ start: hourOnDate(SAT, hour, TZ), label: formatHour(hour), nextDay: hour >= 24 }))

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
