import { describe, expect, it } from 'vitest'
import type { Slot } from '../booking/selection'
import { isWalkInStartable, maxWalkInSlots, nextBooking, operatingDayBookings, todayHoursLabel } from './dashboard'

const now = new Date('2030-01-07T02:30:00.000Z') // 10:30 Manila
const at = (h: number) => new Date(Date.UTC(2030, 0, 7, h - 8)).toISOString()
const slot = (h: number, status: Slot['status']): Slot => ({ court_id: 'A', slot_start: at(h), slot_end: at(h + 1), price: 400, status, booker_first_name: null, open_play_session_id: null, block_key: null })
// 9 past (ended), 10 past (in progress), 11 free, 12 free, 13 booked, 14 free
const day = [slot(9, 'past'), slot(10, 'past'), slot(11, 'free'), slot(12, 'free'), slot(13, 'booked'), slot(14, 'free')]

describe('walk-in slots', () => {
  it('allows the slot in progress but not one that has ended', () => {
    expect(isWalkInStartable(day[1], now)).toBe(true)
    expect(isWalkInStartable(day[0], now)).toBe(false)
    expect(isWalkInStartable(day[4], now)).toBe(false)
  })

  it('counts consecutive startable slots up to the next booking', () => {
    expect(maxWalkInSlots(day, 1, now)).toBe(3)
    expect(maxWalkInSlots(day, 5, now)).toBe(1)
    expect(maxWalkInSlots(day, 4, now)).toBe(0)
  })

  it('stops at a gap in the schedule', () => {
    const gappy = [slot(11, 'free'), slot(13, 'free')]
    expect(maxWalkInSlots(gappy, 0, now)).toBe(1)
  })
})

describe('operatingDayBookings', () => {
  // An overnight operating day: 2030-01-07 18:00 to 2030-01-08 02:00 (UTC instants for brevity).
  const open = { start: '2030-01-07T18:00:00.000Z', end: '2030-01-08T02:00:00.000Z' }
  const b = (id: string, slot_start: string) => ({ id, slot_start })

  it('lists a booking that crosses midnight once, though both calendar dates return it', () => {
    const crossing = b('x', '2030-01-07T23:00:00.000Z')
    const day1 = [b('a', '2030-01-07T19:00:00.000Z'), crossing]
    const day2 = [crossing, b('c', '2030-01-08T01:00:00.000Z')]
    expect(operatingDayBookings([day1, day2], open).map((x) => x.id)).toEqual(['a', 'x', 'c'])
  })

  it('keeps only bookings that start within the operating day, in start order', () => {
    const early = b('early', '2030-01-07T05:00:00.000Z') // the previous operating day's after-midnight slot
    const nextDay = b('next', '2030-01-08T06:00:00.000Z') // the next operating day
    const late = b('late', '2030-01-08T01:00:00.000Z')
    const first = b('first', '2030-01-07T18:00:00.000Z')
    expect(operatingDayBookings([[late, early, first], [nextDay]], open).map((x) => x.id)).toEqual(['first', 'late'])
  })

  it('keeps everything when the day is closed (no range)', () => {
    expect(operatingDayBookings([[b('a', '2030-01-07T05:00:00.000Z')]], null)).toHaveLength(1)
  })
})

describe('todayHoursLabel (T17.30)', () => {
  const tz = 'Asia/Manila'
  const date = '2030-01-07'
  const p = (from: number, to: number) => ({ period_start: at(from), period_end: at(to) })

  it('labels one span', () => {
    expect(todayHoursLabel([p(6, 22)], tz, date)).toBe('Open 6 AM – 10 PM')
  })

  it('merges the same hours of several courts into one span', () => {
    expect(todayHoursLabel([p(6, 22), p(6, 22), p(8, 20)], tz, date)).toBe('Open 6 AM – 10 PM')
  })

  it('merges overlapping and touching spans across courts', () => {
    expect(todayHoursLabel([p(6, 12), p(10, 14), p(14, 22)], tz, date)).toBe('Open 6 AM – 10 PM')
  })

  it('joins separate spans with a comma, earliest first', () => {
    expect(todayHoursLabel([p(14, 22), p(6, 12)], tz, date)).toBe('Open 6 AM – 12 PM, 2 PM – 10 PM')
  })

  it('marks an end past midnight as the next day', () => {
    expect(todayHoursLabel([p(18, 26)], tz, date)).toBe('Open 6 PM – 2 AM (next day)')
  })

  it('handles an early-morning opening (7 AM local is the previous day in UTC)', () => {
    expect(todayHoursLabel([p(7, 9)], tz, date)).toBe('Open 7 AM – 9 AM')
  })

  it('says Open 24 hours for one 24-hour span', () => {
    expect(todayHoursLabel([p(0, 24)], tz, date)).toBe('Open 24 hours')
  })

  it('says Closed today when there are no periods', () => {
    expect(todayHoursLabel([], tz, date)).toBe('Closed today')
  })
})

describe('nextBooking (T17.30)', () => {
  const b = (id: string, from: number, to: number) => ({ id, slot_start: at(from), slot_end: at(to) })

  it('returns the first booking by start that has not ended', () => {
    expect(nextBooking([b('c', 14, 15), b('a', 8, 9), b('b', 11, 12)], now)?.id).toBe('b')
  })

  it('counts a booking in progress', () => {
    expect(nextBooking([b('a', 10, 11), b('b', 14, 15)], now)?.id).toBe('a')
  })

  it('does not count a booking that ends exactly now', () => {
    expect(nextBooking([{ id: 'a', slot_start: at(9), slot_end: now.toISOString() }, b('b', 14, 15)], now)?.id).toBe('b')
  })

  it('returns null when everything has ended or there are none', () => {
    expect(nextBooking([b('a', 8, 9)], now)).toBeNull()
    expect(nextBooking([], now)).toBeNull()
  })
})
