import { describe, expect, it } from 'vitest'
import { formatHour, formatMoney, hourOf, hourToTime } from './format'

describe('formatHour', () => {
  it.each([
    [0, '12 AM'],
    [6, '6 AM'],
    [12, '12 PM'],
    [13, '1 PM'],
    [24, '12 AM'],
  ])('%i → %s', (hour, expected) => {
    expect(formatHour(hour)).toBe(expected)
  })
})

describe('hourOf / hourToTime', () => {
  it('parses Postgres time values, including a 24:00 close', () => {
    expect(hourOf('06:00:00')).toBe(6)
    expect(hourOf('24:00:00')).toBe(24)
  })

  it('pads hours for Postgres', () => {
    expect(hourToTime(6)).toBe('06:00')
    expect(hourToTime(18)).toBe('18:00')
  })
})

describe('formatMoney', () => {
  it('drops decimals for whole amounts and keeps two otherwise', () => {
    expect(formatMoney(500)).toBe('₱500')
    expect(formatMoney(499.5)).toBe('₱499.50')
    expect(formatMoney(1250)).toBe('₱1,250')
  })
})
