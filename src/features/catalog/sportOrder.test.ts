import { describe, expect, it } from 'vitest'
import type { Sport } from './api'
import { nextSortOrder, orderedSports, setCourtOrder, sortCourts, sportsOf } from './sportOrder'

const court = (id: string, sport: Sport, sort_order: number, name = id) => ({ id, sport, sort_order, name })
const TENNIS_FIRST: Sport[] = ['tennis', 'basketball', 'pickleball', 'badminton']

describe('orderedSports', () => {
  it('uses the venue order when it lists every sport once', () => {
    expect(orderedSports(TENNIS_FIRST)).toEqual(TENNIS_FIRST)
  })

  it('falls back to the default order when the setting is missing or incomplete', () => {
    const fallback = ['badminton', 'pickleball', 'basketball', 'tennis']
    expect(orderedSports(undefined)).toEqual(fallback)
    expect(orderedSports(null)).toEqual(fallback)
    expect(orderedSports(['tennis', 'badminton'])).toEqual(fallback)
    expect(orderedSports(['tennis', 'tennis', 'badminton', 'pickleball'])).toEqual(fallback)
  })
})

describe('sortCourts and sportsOf', () => {
  const courts = [
    court('b2', 'badminton', 1), court('t1', 'tennis', 0), court('b1', 'badminton', 0),
    court('b0', 'badminton', 0, 'A tie'), court('k1', 'basketball', 0),
  ]

  it('orders by sport order, then sort_order, then name', () => {
    expect(sortCourts(courts, TENNIS_FIRST).map((c) => c.id)).toEqual(['t1', 'k1', 'b0', 'b1', 'b2'])
    expect(sortCourts(courts, null).map((c) => c.id)).toEqual(['b0', 'b1', 'b2', 'k1', 't1'])
  })

  it('does not change the input array', () => {
    const copy = [...courts]
    sortCourts(courts, TENNIS_FIRST)
    expect(courts).toEqual(copy)
  })

  it('lists the sports that have courts, in list order', () => {
    expect(sportsOf(sortCourts(courts, TENNIS_FIRST))).toEqual(['tennis', 'basketball', 'badminton'])
    expect(sportsOf([])).toEqual([])
  })
})

describe('setCourtOrder (T11.5a)', () => {
  const list = [court('b1', 'badminton', 3), court('b2', 'badminton', 7), court('b3', 'badminton', 9), court('t1', 'tennis', 0)]

  it("puts the sport's courts in the given order and renumbers them like reorder_courts", () => {
    expect(setCourtOrder(list, 'badminton', ['b3', 'b1', 'b2'])).toEqual([
      court('b3', 'badminton', 0), court('b1', 'badminton', 1), court('b2', 'badminton', 2), court('t1', 'tennis', 0),
    ])
  })

  it('leaves the list alone when the ids are missing one, have extras, a duplicate or another sport', () => {
    expect(setCourtOrder(list, 'badminton', ['b3', 'b1'])).toEqual(list)
    expect(setCourtOrder(list, 'badminton', ['b3', 'b1', 'b2', 't1'])).toEqual(list)
    expect(setCourtOrder(list, 'badminton', ['b3', 'b3', 'b2'])).toEqual(list)
    expect(setCourtOrder(list, 'badminton', ['b3', 't1', 'b2'])).toEqual(list)
  })
})

describe('nextSortOrder', () => {
  it('puts a new court after the last one in its sport', () => {
    const list = [court('b1', 'badminton', 3), court('b2', 'badminton', 7), court('t1', 'tennis', 0)]
    expect(nextSortOrder(list, 'badminton')).toBe(8)
    expect(nextSortOrder(list, 'tennis')).toBe(1)
    expect(nextSortOrder(list, 'pickleball')).toBe(0)
  })
})
