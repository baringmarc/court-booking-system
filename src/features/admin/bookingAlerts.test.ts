import { describe, expect, it } from 'vitest'
import { alertTitle, countsAsNew, type BookingChange } from './bookingAlerts'

const change = (status: BookingChange['status'], old_status: BookingChange['old_status'], source = 'online'): BookingChange =>
  ({ booking_id: 'b1', status, old_status, source })

describe('countsAsNew', () => {
  it('counts a booking that becomes payment_submitted (a guest sent a proof)', () => {
    expect(countsAsNew(change('payment_submitted', 'pending_payment'))).toBe(true)
  })
  it('counts a re-submitted proof (confirmed never involved, from any other status)', () => {
    expect(countsAsNew(change('payment_submitted', 'rejected'))).toBe(true)
    expect(countsAsNew(change('payment_submitted', null))).toBe(true)
  })
  it('counts a booking confirmed straight from pending_payment (paid online)', () => {
    expect(countsAsNew(change('confirmed', 'pending_payment'))).toBe(true)
  })
  it('does not count an approval (payment_submitted to confirmed)', () => {
    expect(countsAsNew(change('confirmed', 'payment_submitted'))).toBe(false)
  })
  it('does not count inserts: new holds and walk-ins', () => {
    expect(countsAsNew(change('pending_payment', null))).toBe(false)
    expect(countsAsNew(change('confirmed', null, 'walk_in'))).toBe(false)
  })
  it('does not count cancellations, expiries or rejections', () => {
    expect(countsAsNew(change('cancelled', 'confirmed'))).toBe(false)
    expect(countsAsNew(change('cancelled', 'pending_payment'))).toBe(false)
    expect(countsAsNew(change('expired', 'pending_payment'))).toBe(false)
    expect(countsAsNew(change('rejected', 'payment_submitted'))).toBe(false)
  })
})

describe('alertTitle', () => {
  it('puts the count and the venue name in the tab title', () => {
    expect(alertTitle(2, 'Claudex Courts')).toBe('(2) New bookings · Claudex Courts')
    expect(alertTitle(1, 'Claudex Courts')).toBe('(1) New bookings · Claudex Courts')
  })
})
