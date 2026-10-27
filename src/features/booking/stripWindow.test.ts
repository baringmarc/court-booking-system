import { describe, expect, it } from 'vitest'
import { dayWord, daysBetween, fullDate, monthLabel, stripDays, stripSize, stripStart, tileParts, weekdayOf } from './stripWindow'

const today = '2026-10-27' // a Tuesday
const lastDay = '2026-11-26' // a 30-day window

describe('stripStart', () => {
  it('starts at today', () => {
    expect(stripStart(today, today, today, lastDay)).toBe(today)
    expect(stripDays(today, today, lastDay)).toHaveLength(10)
    expect(stripDays(today, today, lastDay).at(-1)).toBe('2026-11-05')
  })

  it("doesn't move while the day is already shown", () => {
    expect(stripStart(today, '2026-11-05', today, lastDay)).toBe(today)
    expect(stripStart('2026-10-30', '2026-10-30', today, lastDay)).toBe('2026-10-30')
  })

  it('moves one day when a step goes past the last tile, which then holds the day', () => {
    const start = stripStart(today, '2026-11-06', today, lastDay)
    expect(start).toBe('2026-10-28')
    expect(stripDays(start, today, lastDay).at(-1)).toBe('2026-11-06')
  })

  it('moves back so a day before the first tile becomes the first', () => {
    expect(stripStart('2026-11-01', '2026-10-30', today, lastDay)).toBe('2026-10-30')
  })

  it('jumps far ahead with the day as the last tile', () => {
    expect(stripStart(today, '2026-11-20', today, lastDay)).toBe('2026-11-11')
  })

  it('never goes past the last bookable day or before today', () => {
    expect(stripStart(today, lastDay, today, lastDay)).toBe('2026-11-17')
    expect(stripDays('2026-11-17', today, lastDay).at(-1)).toBe(lastDay)
    expect(stripStart('2026-11-30', lastDay, today, lastDay)).toBe('2026-11-17') // a stale start is clamped back
    expect(stripStart('2026-10-01', today, today, lastDay)).toBe(today)
  })

  it('shows fewer tiles when the booking window is under 10 days', () => {
    const short = '2026-10-31' // 4 days ahead: 5 tiles
    expect(stripSize(today, short)).toBe(5)
    expect(stripStart(today, short, today, short)).toBe(today)
    expect(stripDays(today, today, short)).toEqual(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'])
    expect(stripSize(today, today)).toBe(1)
  })
})

describe('labels', () => {
  it('names the months the strip spans, across months and years', () => {
    expect(monthLabel('2026-10-01', '2026-10-10')).toBe('Oct 2026')
    expect(monthLabel('2026-10-27', '2026-11-05')).toBe('Oct – Nov 2026')
    expect(monthLabel('2026-12-28', '2027-01-06')).toBe('Dec 2026 – Jan 2027')
  })

  it('says Today, Tomorrow or the weekday, with the full date', () => {
    expect(dayWord(today, today)).toBe('Today')
    expect(dayWord('2026-10-28', today)).toBe('Tomorrow')
    expect(dayWord('2026-10-30', today)).toBe('Friday')
    expect(fullDate('2026-10-30')).toBe('Friday, October 30, 2026')
  })

  it("labels a tile and knows its weekday, whatever the browser's zone", () => {
    expect(tileParts('2026-10-30')).toEqual({ weekday: 'Fri', day: '30', name: 'Friday, October 30' })
    expect(weekdayOf('2026-10-30')).toBe(5)
    expect(weekdayOf('2026-11-01')).toBe(0)
    expect(daysBetween('2026-10-27', '2026-11-26')).toBe(30)
  })
})
