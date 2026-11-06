// T17.32: the pure helpers behind the opening hours table and the week chart. Minutes run from the operating day's
// midnight; an end past 1440 belongs to the next calendar day. Touching periods are allowed and never merged.
import { describe, expect, it } from 'vitest'
import type { SchedulePeriod } from './api'
import {
  addBreak,
  chartAxis,
  chartDayText,
  overlapMessage,
  removeBreak,
  setDayOpen,
  toSave,
} from './weeklySchedule'

const p = (day: number, startHour: number, endHour: number): SchedulePeriod => ({ day_of_week: day, start_minute: startHour * 60, end_minute: endHour * 60 })
const week = (start = 6, end = 22): SchedulePeriod[] => [0, 1, 2, 3, 4, 5, 6].map((d) => p(d, start, end))
const ofDay = (periods: SchedulePeriod[], day: number) => toSave(periods.filter((x) => x.day_of_week === day))
const others = (periods: SchedulePeriod[], day: number) => toSave(periods.filter((x) => x.day_of_week !== day))

describe('addBreak', () => {
  it('splits a 6 AM – 10 PM day into two periods around a 12 PM – 2 PM break', () => {
    const next = addBreak(week(), 1)
    expect(ofDay(next, 1)).toEqual([p(1, 6, 12), p(1, 14, 22)])
    expect(others(next, 1)).toEqual(others(week(), 1))
  })

  it('can be used more than once: every call adds one period and one closed gap inside the day\'s hours', () => {
    let periods = week()
    for (let n = 1; n <= 3; n++) {
      periods = addBreak(periods, 3)
      const day = ofDay(periods, 3)
      expect(day).toHaveLength(n + 1)
      day.forEach((x, i) => {
        expect(x.end_minute).toBeGreaterThan(x.start_minute)
        expect(x.start_minute % 60).toBe(0)
        expect(x.end_minute % 60).toBe(0)
        if (i > 0) expect(x.start_minute - day[i - 1].end_minute).toBeGreaterThanOrEqual(60) // a real break, never touching
      })
      expect(day[0].start_minute).toBe(360) // the day still opens and closes when it did
      expect(day[day.length - 1].end_minute).toBe(1320)
    }
    expect(others(periods, 3)).toEqual(others(week(), 3))
  })

  it('works on an after-midnight day and a 24-hour day without moving the opening or closing', () => {
    const overnight = ofDay(addBreak([p(5, 18, 26)], 5), 5)
    expect(overnight).toHaveLength(2)
    expect(overnight[0].start_minute).toBe(18 * 60)
    expect(overnight[1].end_minute).toBe(26 * 60)
    expect(overnight[1].start_minute - overnight[0].end_minute).toBeGreaterThanOrEqual(60)

    const full = ofDay(addBreak([p(2, 0, 24)], 2), 2)
    expect(full).toHaveLength(2)
    expect(full[0].start_minute).toBe(0)
    expect(full[1].end_minute).toBe(1440)
  })

  it('leaves a closed day or a day too short for a break unchanged', () => {
    const closed = week().filter((x) => x.day_of_week !== 1)
    expect(toSave(addBreak(closed, 1))).toEqual(toSave(closed))
    const short = [p(1, 8, 10)]
    expect(toSave(addBreak(short, 1))).toEqual(toSave(short))
  })

  it('does not mutate its input', () => {
    const input = week()
    const copy = JSON.parse(JSON.stringify(input))
    addBreak(input, 1)
    expect(input).toEqual(copy)
  })
})

describe('removeBreak', () => {
  it('joins the two ranges around the break again', () => {
    const split = [p(1, 6, 12), p(1, 14, 22), p(2, 6, 22)]
    expect(toSave(removeBreak(split, 1, 0))).toEqual([p(1, 6, 22), p(2, 6, 22)])
  })

  it('removes only the chosen break, counting breaks in time order', () => {
    const three = [p(1, 6, 10), p(1, 12, 14), p(1, 16, 22)]
    expect(toSave(removeBreak(three, 1, 0))).toEqual([p(1, 6, 14), p(1, 16, 22)])
    expect(toSave(removeBreak(three, 1, 1))).toEqual([p(1, 6, 10), p(1, 12, 22)])
  })

  it('add then remove gives back the original day', () => {
    expect(toSave(removeBreak(addBreak(week(), 4), 4, 0))).toEqual(toSave(week()))
  })

  it('keeps a closing past midnight', () => {
    expect(toSave(removeBreak([p(5, 10, 14), p(5, 16, 26)], 5, 0))).toEqual([p(5, 10, 26)])
  })
})

describe('setDayOpen', () => {
  it('closing drops that day\'s periods only', () => {
    const next = setDayOpen(week(), 1, false, week())
    expect(ofDay(next, 1)).toEqual([])
    expect(others(next, 1)).toEqual(others(week(), 1))
  })

  it('opening restores the saved periods of the day, breaks included', () => {
    const saved = [p(2, 8, 12), p(2, 14, 20), p(3, 6, 22)]
    const closed = setDayOpen(saved, 2, false, saved)
    expect(ofDay(setDayOpen(closed, 2, true, saved), 2)).toEqual([p(2, 8, 12), p(2, 14, 20)])
  })

  it('opening a day that was never open gives 6 AM – 10 PM', () => {
    const saved = week().filter((x) => x.day_of_week !== 0)
    expect(ofDay(setDayOpen(saved, 0, true, saved), 0)).toEqual([p(0, 6, 22)])
  })

  it('opening an already open day changes nothing', () => {
    expect(toSave(setDayOpen(week(), 1, true, week()))).toEqual(toSave(week()))
  })
})

describe('overlapMessage', () => {
  it('is null when nothing overlaps, touching periods and an after-midnight close that meets the next opening included', () => {
    expect(overlapMessage(week(), 1)).toBeNull()
    expect(overlapMessage([p(1, 6, 12), p(1, 12, 22)], 1)).toBeNull()
    expect(overlapMessage([p(1, 18, 26), p(2, 2, 22)], 1)).toBeNull()
    expect(overlapMessage([p(1, 18, 26), p(2, 2, 22)], 2)).toBeNull()
  })

  it('explains in plain words that Monday running past midnight clashes with Tuesday\'s opening', () => {
    const periods = [p(1, 18, 26), p(2, 1, 22)]
    for (const day of [1, 2]) {
      const message = overlapMessage(periods, day)
      expect(message).toMatch(/overlap/i)
      expect(message).toContain('Monday')
      expect(message).toContain('Tuesday')
    }
    expect(overlapMessage(periods, 3)).toBeNull()
  })

  it('covers Sunday into Monday across the week\'s wrap', () => {
    const periods = [p(0, 20, 27), p(1, 1, 22)]
    for (const day of [0, 1]) {
      const message = overlapMessage(periods, day)
      expect(message).toMatch(/overlap/i)
      expect(message).toContain('Sunday')
      expect(message).toContain('Monday')
    }
  })

  it('covers Saturday into Sunday across the wrap, and a lone period never overlaps itself', () => {
    expect(overlapMessage([p(6, 20, 26), p(0, 1, 22)], 6)).toMatch(/overlap/i)
    expect(overlapMessage([p(0, 12, 36)], 0)).toBeNull()
  })

  it('covers two periods inside one day', () => {
    const message = overlapMessage([p(3, 6, 14), p(3, 12, 22)], 3)
    expect(message).toMatch(/overlap/i)
    expect(message).toContain('Wednesday')
  })
})

describe('chartAxis', () => {
  it('fits the hours to the earliest opening and the latest closing of the week', () => {
    expect(chartAxis([p(1, 8, 20), p(2, 9, 22), p(3, 7, 18)])).toEqual({ from: 7, to: 22 })
  })

  it('lets the latest closing run past 24 for after-midnight days', () => {
    expect(chartAxis([p(5, 18, 26), p(6, 10, 22)])).toEqual({ from: 10, to: 26 })
  })

  it('shows a 24-hour day as 0 to 24', () => {
    expect(chartAxis([p(1, 0, 24), p(2, 8, 20)])).toEqual({ from: 0, to: 24 })
  })

  it('takes breaks and the whole default week into account', () => {
    expect(chartAxis(addBreak(week(), 1))).toEqual({ from: 6, to: 22 })
  })

  it('still returns a usable axis for a week with no opening hours', () => {
    const axis = chartAxis([])
    expect(Number.isFinite(axis.from)).toBe(true)
    expect(Number.isFinite(axis.to)).toBe(true)
    expect(axis.to).toBeGreaterThan(axis.from)
  })
})

describe('chartDayText', () => {
  it('says a day with no periods is closed', () => {
    expect(chartDayText(week().filter((x) => x.day_of_week !== 1), 1)).toBe('Monday: closed')
  })

  it('describes one range', () => {
    expect(chartDayText(week(), 3)).toBe('Wednesday: open 6 AM to 10 PM')
  })

  it('describes a break as two ranges', () => {
    expect(chartDayText([p(1, 6, 12), p(1, 14, 22)], 1)).toBe('Monday: open 6 AM to 12 PM and 2 PM to 10 PM')
  })

  it('describes several breaks with commas and a last "and", in time order whatever the input order', () => {
    expect(chartDayText([p(1, 16, 22), p(1, 6, 10), p(1, 12, 14)], 1)).toBe('Monday: open 6 AM to 10 AM, 12 PM to 2 PM and 4 PM to 10 PM')
  })

  it('marks an after-midnight close with (next day)', () => {
    expect(chartDayText([p(5, 22, 26)], 5)).toBe('Friday: open 10 PM to 2 AM (next day)')
  })

  it('says 24 hours for 12 AM to Midnight', () => {
    expect(chartDayText([p(0, 0, 24)], 0)).toBe('Sunday: open 24 hours')
  })

  it('ends at Midnight when a day closes at 24', () => {
    expect(chartDayText([p(6, 10, 24)], 6)).toBe('Saturday: open 10 AM to Midnight')
  })
})
