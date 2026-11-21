// T30.4: "Same time next week" (SPEC §8): the first start after `now` on the same weekday and venue-local wall-clock
// time as the booking, found by adding whole local calendar weeks.
import { describe, expect, it } from 'vitest'
import { nextSameTimeStart } from './rebook'

const MANILA = 'Asia/Manila'
const NEW_YORK = 'America/New_York'

describe('nextSameTimeStart', () => {
  it('returns the start plus 7 days for a booking in the future', () => {
    expect(nextSameTimeStart('2030-01-07T09:00:00.000Z', MANILA, new Date('2030-01-01T00:00:00.000Z'))).toBe('2030-01-14T09:00:00.000Z')
  })

  it('returns the start plus 14 days when the next week has already started (one week and a bit in the past)', () => {
    expect(nextSameTimeStart('2030-01-07T09:00:00.000Z', MANILA, new Date('2030-01-14T10:00:00.000Z'))).toBe('2030-01-21T09:00:00.000Z')
  })

  it('skips every week that has passed (a booking four weeks ago)', () => {
    // 01-14, 01-21 and 01-28 are behind 2030-02-01; the next one is 02-04.
    expect(nextSameTimeStart('2030-01-07T09:00:00.000Z', MANILA, new Date('2030-02-01T12:00:00.000Z'))).toBe('2030-02-04T09:00:00.000Z')
  })

  it('treats a start exactly equal to now as not in the future', () => {
    expect(nextSameTimeStart('2030-01-07T09:00:00.000Z', MANILA, new Date('2030-01-14T09:00:00.000Z'))).toBe('2030-01-21T09:00:00.000Z')
  })

  it('accepts a start one millisecond after now', () => {
    expect(nextSameTimeStart('2030-01-07T09:00:00.000Z', MANILA, new Date('2030-01-14T08:59:59.999Z'))).toBe('2030-01-14T09:00:00.000Z')
  })

  it('returns an ISO string in UTC with milliseconds', () => {
    expect(nextSameTimeStart('2030-01-07T09:00:00Z', MANILA, new Date('2030-01-01T00:00:00Z'))).toBe('2030-01-14T09:00:00.000Z')
  })

  it('keeps the venue-local hour when the UTC date differs from the venue date (1 AM Manila)', () => {
    // 2030-01-07T17:00Z is Tue 2030-01-08 01:00 in Manila; the next is Tue 2030-01-15 01:00 = 2030-01-14T17:00Z.
    expect(nextSameTimeStart('2030-01-07T17:00:00.000Z', MANILA, new Date('2030-01-01T00:00:00.000Z'))).toBe('2030-01-14T17:00:00.000Z')
  })

  it('keeps the venue-local hour for an early-morning slot (7 AM Manila is the previous UTC day)', () => {
    expect(nextSameTimeStart('2030-01-06T23:00:00.000Z', MANILA, new Date('2030-01-01T00:00:00.000Z'))).toBe('2030-01-13T23:00:00.000Z')
    expect(nextSameTimeStart('2030-01-06T23:00:00.000Z', MANILA, new Date('2030-01-13T23:00:00.000Z'))).toBe('2030-01-20T23:00:00.000Z')
  })

  it('is the same weekday and wall-clock time as the booking, strictly after now, for any now (any hour, any weekday)', () => {
    const slot = '2030-01-07T17:00:00.000Z' // 1 AM Manila
    const week = 7 * 24 * 3_600_000
    for (let i = 0; i < 24 * 20; i += 5) {
      const now = new Date(Date.parse('2030-01-01T00:00:00.000Z') + i * 3_600_000 + 17 * 60_000)
      const next = Date.parse(nextSameTimeStart(slot, MANILA, now))
      expect(next).toBeGreaterThan(now.getTime())
      // Either the first week after the booking (when now is before it) or less than a week past now.
      expect(next === Date.parse(slot) + week || next - week <= now.getTime()).toBe(true)
      expect((next - Date.parse(slot)) % week).toBe(0) // Manila has no DST: whole weeks
      expect(next).toBeGreaterThanOrEqual(Date.parse(slot) + week)
    }
  })

  it('keeps the wall-clock hour across the spring-forward change (America/New_York, 7 PM)', () => {
    // Thu 2030-03-07 19:00 EST = 2030-03-08T00:00Z. DST starts Sun 2030-03-10, so Thu 03-14 19:00 is EDT = 23:00Z.
    expect(nextSameTimeStart('2030-03-08T00:00:00.000Z', NEW_YORK, new Date('2030-03-01T00:00:00.000Z'))).toBe('2030-03-14T23:00:00.000Z')
  })

  it('keeps the wall-clock hour across the fall-back change (America/New_York, 7 PM)', () => {
    // Thu 2030-10-31 19:00 EDT = 23:00Z. DST ends Sun 2030-11-03, so Thu 11-07 19:00 is EST = 2030-11-08T00:00Z.
    expect(nextSameTimeStart('2030-10-31T23:00:00.000Z', NEW_YORK, new Date('2030-10-25T00:00:00.000Z'))).toBe('2030-11-08T00:00:00.000Z')
  })

  it('skips a past week across a DST change and keeps the hour', () => {
    // Thu 03-07 19:00 EST booking; now is after Thu 03-14 19:00 EDT (23:00Z), so the answer is Thu 03-21 19:00 EDT.
    expect(nextSameTimeStart('2030-03-08T00:00:00.000Z', NEW_YORK, new Date('2030-03-14T23:30:00.000Z'))).toBe('2030-03-21T23:00:00.000Z')
  })
})
