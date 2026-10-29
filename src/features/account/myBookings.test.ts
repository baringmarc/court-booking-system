import { describe, expect, it } from 'vitest'
import type { MyBooking } from './api'
import { mySortFromParams, splitMyBookings } from './myBookings'

const now = new Date('2030-01-07T08:00:00.000Z')
const row = (ref: string, startIso: string, overrides: Partial<MyBooking> = {}): MyBooking => ({
  id: ref, reference_code: ref, court_name: 'Court', sport: 'tennis',
  slot_start: startIso, slot_end: new Date(Date.parse(startIso) + 3_600_000).toISOString(),
  status: 'confirmed', expires_at: null, amount_due: 500, parent_booking_id: null, created_at: '2030-01-01T00:00:00.000Z', ...overrides,
})

describe('splitMyBookings', () => {
  it('puts active future bookings in upcoming, soonest first', () => {
    const { upcoming, past } = splitMyBookings([
      row('LATER', '2030-01-09T10:00:00.000Z'),
      row('SOON', '2030-01-07T10:00:00.000Z', { status: 'payment_submitted' }),
      row('HOLD', '2030-01-08T10:00:00.000Z', { status: 'pending_payment', expires_at: '2030-01-07T08:30:00.000Z' }),
    ], now)
    expect(upcoming.map((b) => b.reference_code)).toEqual(['SOON', 'HOLD', 'LATER'])
    expect(past).toEqual([])
  })

  it('keeps a booking in progress upcoming until it ends', () => {
    const { upcoming } = splitMyBookings([row('NOW', '2030-01-07T07:30:00.000Z')], now)
    expect(upcoming.map((b) => b.reference_code)).toEqual(['NOW'])
  })

  it('moves ended, cancelled, rejected, expired and stale holds to past, most recent first', () => {
    const { upcoming, past } = splitMyBookings([
      row('DONE', '2030-01-06T10:00:00.000Z'),
      row('CANCELLED', '2030-01-10T10:00:00.000Z', { status: 'cancelled' }),
      row('REJECTED', '2030-01-09T10:00:00.000Z', { status: 'rejected' }),
      row('EXPIRED', '2030-01-08T10:00:00.000Z', { status: 'expired' }),
      row('STALE', '2030-01-08T12:00:00.000Z', { status: 'pending_payment', expires_at: '2030-01-07T07:59:00.000Z' }),
    ], now)
    expect(upcoming).toEqual([])
    expect(past.map((b) => b.reference_code)).toEqual(['CANCELLED', 'REJECTED', 'STALE', 'EXPIRED', 'DONE'])
  })

  it('sorts both lists by when they were booked, newest or oldest first (T11.5b)', () => {
    const rows = [
      row('UP-A', '2030-01-08T10:00:00.000Z', { created_at: '2030-01-03T00:00:00.000Z' }),
      row('UP-B', '2030-01-09T10:00:00.000Z', { created_at: '2030-01-05T00:00:00.000Z' }),
      row('PAST-A', '2030-01-05T10:00:00.000Z', { created_at: '2030-01-02T00:00:00.000Z' }),
      row('PAST-B', '2030-01-04T10:00:00.000Z', { created_at: '2030-01-04T00:00:00.000Z' }),
    ]
    const newest = splitMyBookings(rows, now, 'booked-desc')
    expect(newest.upcoming.map((b) => b.reference_code)).toEqual(['UP-B', 'UP-A'])
    expect(newest.past.map((b) => b.reference_code)).toEqual(['PAST-B', 'PAST-A'])
    const oldest = splitMyBookings(rows, now, 'booked-asc')
    expect(oldest.upcoming.map((b) => b.reference_code)).toEqual(['UP-A', 'UP-B'])
    expect(oldest.past.map((b) => b.reference_code)).toEqual(['PAST-A', 'PAST-B'])
    // Play time is the default: upcoming soonest first, past most recent first.
    const play = splitMyBookings(rows, now)
    expect(play.upcoming.map((b) => b.reference_code)).toEqual(['UP-A', 'UP-B'])
    expect(play.past.map((b) => b.reference_code)).toEqual(['PAST-A', 'PAST-B'])
  })

  it('reads the sort from the URL, defaulting to play time', () => {
    expect(mySortFromParams(new URLSearchParams('sort=booked-asc'))).toBe('booked-asc')
    expect(mySortFromParams(new URLSearchParams('sort=price'))).toBe('play')
    expect(mySortFromParams(new URLSearchParams())).toBe('play')
  })
})
