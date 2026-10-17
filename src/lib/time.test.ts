import { describe, expect, it } from 'vitest'
import { formatInZone, zonedLocalToISO } from './time'

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
