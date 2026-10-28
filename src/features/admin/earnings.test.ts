import { describe, expect, it } from 'vitest'
import {
  hourBar,
  barShares, change, formatHours, formatShare, occupancy, parseEarnings, periodRange, previousLabel, rangeDays,
  rangeProblem, weekStart,
} from './earnings'

describe('periods', () => {
  it('starts weeks on Monday', () => {
    expect(weekStart('2026-10-26')).toBe('2026-10-26') // a Monday
    expect(weekStart('2026-10-25')).toBe('2026-10-19') // a Sunday belongs to the week before
    expect(weekStart('2026-10-28')).toBe('2026-10-26')
    expect(weekStart('2027-01-01')).toBe('2026-12-28') // across a year
  })

  it('covers whole periods', () => {
    expect(periodRange('today', '2026-10-28')).toEqual({ from: '2026-10-28', to: '2026-10-28' })
    expect(periodRange('week', '2026-10-25')).toEqual({ from: '2026-10-19', to: '2026-10-25' })
    expect(periodRange('month', '2026-10-25')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(periodRange('month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' }) // a leap year
    expect(periodRange('month', '2026-11-30')).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(periodRange('custom', '2026-10-25', { from: '2026-09-01', to: '2026-09-15' })).toEqual({ from: '2026-09-01', to: '2026-09-15' })
  })

  it('counts days and checks custom ranges', () => {
    expect(rangeDays({ from: '2026-10-25', to: '2026-10-25' })).toBe(1)
    expect(rangeDays({ from: '2026-01-01', to: '2026-12-31' })).toBe(365)
    expect(rangeProblem({ from: '2026-10-25', to: '2026-10-24' })).toBe('The end date is before the start date.')
    expect(rangeProblem({ from: '2026-01-01', to: '2027-01-01' })).toBe(null) // 366 days
    expect(rangeProblem({ from: '2026-01-01', to: '2027-01-02' })).toBe('Choose a range of up to 366 days.')
  })

  it('names the previous period', () => {
    expect(previousLabel('today', 1)).toBe('yesterday')
    expect(previousLabel('week', 7)).toBe('last week')
    expect(previousLabel('month', 31)).toBe('the previous 31 days')
  })
})

describe('parseEarnings', () => {
  it('reads the RPC result into numbers', () => {
    const e = parseEarnings({
      from: '2026-10-19', to: '2026-10-25', timezone: 'Asia/Manila',
      collected: { total: 1500, count: 3, by_method: [{ method: 'cash', amount: 600, count: 1 }] },
      previous: { from: '2026-10-12', to: '2026-10-18', total: 250, count: 1, by_method: [] },
      refunds_due: { count: 1, total: 300 },
      daily: [{ date: '2026-10-19', collected: 400, sold_hours: 2 }],
      courts: [{ court_id: 'A', name: 'Court 1', sport: 'tennis', open_hours: 104, blackout_hours: 8, sold_hours: 3, open_play_hours: 0 }],
      sports: [{ sport: 'tennis', open_hours: 104, blackout_hours: 8, sold_hours: 3, open_play_hours: 0 }],
      coming_up: { count: 2, value: 1300 },
    })
    expect(e.collected).toEqual({ total: 1500, count: 3, byMethod: [{ method: 'cash', amount: 600, count: 1 }] })
    expect(e.previous).toMatchObject({ from: '2026-10-12', to: '2026-10-18', total: 250 })
    expect(e.refundsDue).toEqual({ count: 1, total: 300 })
    expect(e.daily).toEqual([{ date: '2026-10-19', collected: 400, soldHours: 2 }])
    expect(e.courts[0]).toEqual({ courtId: 'A', name: 'Court 1', sport: 'tennis', openHours: 104, blackoutHours: 8, soldHours: 3, openPlayHours: 0 })
    expect(e.comingUp).toEqual({ count: 2, value: 1300 })
  })

  it('reads numeric strings and treats missing parts as empty', () => {
    const e = parseEarnings({ collected: { total: '12.50' }, courts: null })
    expect(e.collected).toEqual({ total: 12.5, count: 0, byMethod: [] })
    expect(e.courts).toEqual([])
    expect(e.daily).toEqual([])
    expect(e.comingUp).toEqual({ count: 0, value: 0 })
  })
})

describe('figures', () => {
  const h = (openHours: number, blackoutHours: number, soldHours: number) => ({ openHours, blackoutHours, soldHours, openPlayHours: 0 })

  it('works out occupancy from bookable hours', () => {
    expect(occupancy(h(100, 20, 40))).toBe(0.5)
    expect(occupancy(h(16, 0, 0))).toBe(0)
  })

  it('has no occupancy when nothing was bookable', () => {
    expect(occupancy(h(0, 0, 0))).toBeNull()
    expect(occupancy(h(16, 16, 0))).toBeNull()
  })

  it('caps occupancy at 100% (a booking under a blackout counts as both)', () => {
    expect(occupancy(h(10, 8, 4))).toBe(1)
  })

  it('formats shares and hours', () => {
    expect(formatShare(0.426)).toBe('43%')
    expect(formatShare(null)).toBe('—')
    expect(formatHours(12)).toBe('12 h')
    expect(formatHours(1.25)).toBe('1.3 h')
  })

  it('compares with the previous period', () => {
    expect(change(1500, 1000)).toEqual({ diff: 500, percent: 50 })
    expect(change(800, 1000)).toEqual({ diff: -200, percent: -20 })
    expect(change(500, 0)).toEqual({ diff: 500, percent: null })
    expect(change(0, 0)).toEqual({ diff: 0, percent: null })
  })

  it('sizes bars against the best day', () => {
    expect(barShares([0, 50, 100])).toEqual([0, 0.5, 1])
    expect(barShares([0, 0])).toEqual([0, 0])
    expect(barShares([])).toEqual([])
  })
})

describe('hourBar (T11.5)', () => {
  const h = (openHours: number, blackoutHours: number, soldHours: number, openPlayHours: number) =>
    ({ openHours, blackoutHours, soldHours, openPlayHours })

  it('splits the bookable hours into booked and open play', () => {
    expect(hourBar(h(84, 0, 52, 8))).toEqual({ booked: 52 / 84, openPlay: 8 / 84, bookable: 84 })
  })

  it('leaves out blackout hours, and caps the two shares at the whole bar', () => {
    expect(hourBar(h(16, 4, 6, 0))).toEqual({ booked: 0.5, openPlay: 0, bookable: 12 })
    // 3 sold of 2 bookable (a booking under a blackout): full, with no room for open play.
    expect(hourBar(h(16, 14, 3, 1))).toEqual({ booked: 1, openPlay: 0, bookable: 2 })
    expect(hourBar(h(10, 0, 6, 8))).toEqual({ booked: 0.6, openPlay: 0.4, bookable: 10 })
  })

  it('is null when nothing was bookable', () => {
    expect(hourBar(h(0, 0, 0, 0))).toBeNull()
    expect(hourBar(h(8, 8, 0, 0))).toBeNull()
  })
})
