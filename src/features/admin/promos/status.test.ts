// T19.2: the badge a promo wears in the list. Dates are venue operating dates compared as plain YYYY-MM-DD strings, both ends inclusive.
import { describe, expect, it } from 'vitest'
import { promoStatus } from './status'

const promo = (starts_on: string, ends_on: string, is_active = true) => ({ starts_on, ends_on, is_active })

describe('promoStatus', () => {
  it('is active inside the range', () => {
    expect(promoStatus(promo('2030-01-01', '2030-01-31'), '2030-01-15')).toBe('active')
  })

  it('is active on its first day and on its last day (both inclusive)', () => {
    expect(promoStatus(promo('2030-01-04', '2030-01-10'), '2030-01-04')).toBe('active')
    expect(promoStatus(promo('2030-01-04', '2030-01-10'), '2030-01-10')).toBe('active')
  })

  it('is active for a one-day promo on that day', () => {
    expect(promoStatus(promo('2030-01-04', '2030-01-04'), '2030-01-04')).toBe('active')
  })

  it('is upcoming the day before it starts', () => {
    expect(promoStatus(promo('2030-01-05', '2030-01-10'), '2030-01-04')).toBe('upcoming')
  })

  it('is ended the day after it ends', () => {
    expect(promoStatus(promo('2030-01-01', '2030-01-03'), '2030-01-04')).toBe('ended')
  })

  it('compares across a month and year boundary as dates, not as numbers', () => {
    expect(promoStatus(promo('2029-12-30', '2030-01-02'), '2030-01-01')).toBe('active')
    expect(promoStatus(promo('2029-12-30', '2029-12-31'), '2030-01-01')).toBe('ended')
    expect(promoStatus(promo('2030-02-01', '2030-02-28'), '2030-01-31')).toBe('upcoming')
  })

  it('is paused when switched off, whatever the dates say', () => {
    expect(promoStatus(promo('2030-01-01', '2030-01-31', false), '2030-01-15')).toBe('paused')
    expect(promoStatus(promo('2030-01-01', '2030-01-03', false), '2030-01-15')).toBe('paused')
    expect(promoStatus(promo('2030-02-01', '2030-02-28', false), '2030-01-15')).toBe('paused')
  })
})
