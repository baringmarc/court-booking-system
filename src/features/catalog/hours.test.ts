import { describe, expect, it } from 'vitest'
import { dowOf, isAfterMidnight } from './hours'

// T32.2 removed the legacy weekly-hours helpers (summarizeHours, daySpan, operatingToday, operatingDayRange, …) and
// their tests: hours come from the effective schedule periods. summarizeSchedule is covered in hours.schedule.test.ts.

describe('operating date helpers', () => {
  // 2030-01-08 is a Tuesday; Manila is UTC+8.
  const manila = (local: string) => new Date(`${local}+08:00`)

  it('tells after-midnight slots apart from the operating date', () => {
    expect(isAfterMidnight(manila('2030-01-07T23:00').toISOString(), '2030-01-07', 'Asia/Manila')).toBe(false)
    expect(isAfterMidnight(manila('2030-01-08T01:00').toISOString(), '2030-01-07', 'Asia/Manila')).toBe(true)
  })

  it('gives the day of week of a date', () => {
    expect(dowOf('2030-01-07')).toBe(1)
  })
})
