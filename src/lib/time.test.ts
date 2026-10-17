import { describe, expect, it } from 'vitest'
import { addDays, formatDateLabel, formatInZone, hourInZone, parseTstzRange, todayInZone, zonedLocalToISO } from './time'

describe('zonedLocalToISO', () => {
  it('converts Manila wall-clock time to UTC (UTC+8, previous UTC day)', () => {
    expect(zonedLocalToISO('2026-10-17T07:00', 'Asia/Manila')).toBe('2026-10-16T23:00:00.000Z')
  })

  it('treats a bare date as local midnight', () => {
    expect(zonedLocalToISO('2026-10-17', 'Asia/Manila')).toBe('2026-10-16T16:00:00.000Z')
  })

  it('handles zones with DST on both sides of the switch', () => {
    expect(zonedLocalToISO('2026-01-15T12:00', 'America/New_York')).toBe('2026-01-15T17:00:00.000Z')
    expect(zonedLocalToISO('2026-07-01T12:00', 'America/New_York')).toBe('2026-07-01T16:00:00.000Z')
  })
})

describe('formatInZone', () => {
  it('formats in the given zone, not the machine zone', () => {
    const iso = '2026-10-16T23:00:00.000Z'
    expect(formatInZone(iso, 'Asia/Manila', { day: 'numeric' })).toBe('17')
    expect(formatInZone(iso, 'Asia/Manila', { hour: '2-digit', hourCycle: 'h23' })).toBe('07')
  })
})

describe('todayInZone / addDays', () => {
  it('uses the venue date, not the UTC date', () => {
    // 2026-10-16 17:00 UTC is already the 17th in Manila
    expect(todayInZone('Asia/Manila', new Date('2026-10-16T17:00:00Z'))).toBe('2026-10-17')
    expect(todayInZone('UTC', new Date('2026-10-16T17:00:00Z'))).toBe('2026-10-16')
  })

  it('adds calendar days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('parseTstzRange', () => {
  it('parses the PostgREST text form of a tstzrange', () => {
    expect(parseTstzRange('["2026-10-20 02:00:00+00","2026-10-20 04:00:00+00")')).toEqual({
      start: '2026-10-20T02:00:00.000Z',
      end: '2026-10-20T04:00:00.000Z',
    })
  })

  it('handles non-UTC offsets and unquoted bounds', () => {
    expect(parseTstzRange('[2026-10-20 10:00:00+08,2026-10-20 11:00:00+08)')).toEqual({
      start: '2026-10-20T02:00:00.000Z',
      end: '2026-10-20T03:00:00.000Z',
    })
  })

  it('rejects anything that is not a range', () => {
    expect(() => parseTstzRange(null)).toThrow()
    expect(() => parseTstzRange('empty')).toThrow()
  })
})

describe('hourInZone / formatDateLabel', () => {
  it('reads the hour in the venue timezone', () => {
    expect(hourInZone('2026-10-16T23:00:00.000Z', 'Asia/Manila')).toBe(7)
    expect(hourInZone('2026-10-16T16:00:00.000Z', 'Asia/Manila')).toBe(0)
  })

  it('labels a calendar date without shifting it', () => {
    expect(formatDateLabel('2026-10-17', 'Asia/Manila')).toMatch(/Sat.*Oct.*17/)
  })
})
