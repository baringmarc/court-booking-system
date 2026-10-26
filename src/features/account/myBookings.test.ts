import { describe, expect, it } from 'vitest'
import type { MyBooking } from './api'
import { splitMyBookings } from './myBookings'

const now = new Date('2030-01-07T08:00:00.000Z')
const row = (ref: string, startIso: string, overrides: Partial<MyBooking> = {}): MyBooking => ({
  id: ref, reference_code: ref, court_name: 'Court', sport: 'tennis',
  slot_start: startIso, slot_end: new Date(Date.parse(startIso) + 3_600_000).toISOString(),
  status: 'confirmed', expires_at: null, total_amount: 500, parent_booking_id: null, ...overrides,
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
})
