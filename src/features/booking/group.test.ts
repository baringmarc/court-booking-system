// T33.4: the status and the cancel input of a booking group (SPEC §7 `/booking/:ref`, "A booking in a group"). A group
// reads as one checkout: cancelled courts don't count, and the status is the first present of
// pending_payment, payment_submitted, confirmed, completed, expired, rejected.
import { describe, expect, it } from 'vitest'
import type { BookingDetail, BookingGroupCourt } from './api'
import { groupCancelInput, groupDisplayStatus } from './group'
import { playerCancel } from './cancellation'
import type { BookingStatus } from './status'

// 2030-01-07 04:00 in Manila (the early morning is the previous UTC day).
const NOW = new Date('2030-01-06T20:00:00.000Z')
const FUTURE_END = '2030-01-07T10:00:00.000Z'
const PAST_END = '2030-01-06T10:00:00.000Z'

const court = (status: BookingStatus, slot_end = FUTURE_END, expires_at?: string | null) => ({ status, slot_end, expires_at })

describe('groupDisplayStatus', () => {
  it('is cancelled when every court is cancelled, and when there are no courts', () => {
    expect(groupDisplayStatus([court('cancelled'), court('cancelled')], NOW)).toBe('cancelled')
    expect(groupDisplayStatus([], NOW)).toBe('cancelled')
  })

  it('drops cancelled courts: the others decide', () => {
    expect(groupDisplayStatus([court('cancelled'), court('confirmed')], NOW)).toBe('confirmed')
    expect(groupDisplayStatus([court('cancelled'), court('payment_submitted')], NOW)).toBe('payment_submitted')
  })

  it('is the common status when the courts agree', () => {
    expect(groupDisplayStatus([court('pending_payment'), court('pending_payment')], NOW)).toBe('pending_payment')
    expect(groupDisplayStatus([court('payment_submitted'), court('payment_submitted')], NOW)).toBe('payment_submitted')
    expect(groupDisplayStatus([court('confirmed'), court('confirmed')], NOW)).toBe('confirmed')
    expect(groupDisplayStatus([court('rejected'), court('rejected')], NOW)).toBe('rejected')
  })

  it('orders pending_payment, payment_submitted, confirmed, completed, expired, rejected', () => {
    expect(groupDisplayStatus([court('confirmed'), court('pending_payment')], NOW)).toBe('pending_payment')
    expect(groupDisplayStatus([court('confirmed'), court('payment_submitted')], NOW)).toBe('payment_submitted')
    expect(groupDisplayStatus([court('payment_submitted'), court('pending_payment')], NOW)).toBe('pending_payment')
    expect(groupDisplayStatus([court('expired'), court('confirmed')], NOW)).toBe('confirmed')
    expect(groupDisplayStatus([court('rejected'), court('expired')], NOW)).toBe('expired')
    expect(groupDisplayStatus([court('rejected'), court('confirmed', PAST_END)], NOW)).toBe('completed')
  })

  it('is confirmed while one court is confirmed and another has been played; completed once every court has', () => {
    expect(groupDisplayStatus([court('confirmed', PAST_END), court('confirmed', FUTURE_END)], NOW)).toBe('confirmed')
    expect(groupDisplayStatus([court('confirmed', PAST_END), court('confirmed', PAST_END)], NOW)).toBe('completed')
    // A cancelled court doesn't hold the group back from being completed.
    expect(groupDisplayStatus([court('confirmed', PAST_END), court('cancelled', FUTURE_END)], NOW)).toBe('completed')
  })

  it('uses each court’s displayed status: a pending hold past its expires_at is expired', () => {
    const past = '2030-01-06T19:59:00.000Z'
    expect(groupDisplayStatus([court('pending_payment', FUTURE_END, past), court('pending_payment', FUTURE_END, past)], NOW)).toBe('expired')
    // Still inside its hold: pending.
    expect(groupDisplayStatus([court('pending_payment', FUTURE_END, '2030-01-06T20:30:00.000Z')], NOW)).toBe('pending_payment')
    // An expired court next to a confirmed one: the confirmed one wins over expired.
    expect(groupDisplayStatus([court('pending_payment', FUTURE_END, past), court('confirmed')], NOW)).toBe('confirmed')
  })
})

const groupCourt = (overrides: Partial<BookingGroupCourt>): BookingGroupCourt => ({
  reference_code: 'CB-LEAD01', court_id: null, court_name: 'Badminton 1', sport: 'badminton',
  slot_start: '2030-01-06T23:00:00.000Z', slot_end: '2030-01-07T00:00:00.000Z', status: 'confirmed',
  total_amount: 350, booking_fee: 10, amount_due: 360, refund: null, ...overrides,
})
const own: Pick<BookingDetail, 'expires_at'> = { expires_at: '2030-01-06T23:30:00.000Z' }

describe('groupCancelInput', () => {
  const early = groupCourt({ reference_code: 'CB-EARLY1', slot_start: '2030-01-06T23:00:00.000Z', slot_end: '2030-01-07T00:00:00.000Z', status: 'pending_payment' })
  const late = groupCourt({ reference_code: 'CB-LATE02', court_name: 'Tennis Court', slot_start: '2030-01-07T15:00:00.000Z', slot_end: '2030-01-07T17:00:00.000Z', status: 'payment_submitted' })

  it('counts the active courts, from the earliest start to the latest end, with the first active court’s status and the booking’s expires_at', () => {
    expect(groupCancelInput(own, [early, late], NOW)).toEqual({
      status: 'pending_payment',
      expires_at: own.expires_at,
      slot_start: '2030-01-06T23:00:00.000Z',
      slot_end: '2030-01-07T17:00:00.000Z',
      courts: 2,
    })
  })

  it('leaves out a cancelled court and one that has ended', () => {
    const cancelled = groupCourt({ reference_code: 'CB-GONE03', slot_start: '2030-01-06T22:00:00.000Z', slot_end: '2030-01-06T23:00:00.000Z', status: 'cancelled' })
    const played = groupCourt({ reference_code: 'CB-DONE04', slot_start: '2030-01-06T08:00:00.000Z', slot_end: '2030-01-06T09:00:00.000Z', status: 'confirmed' })
    expect(groupCancelInput(own, [cancelled, played, late], NOW)).toEqual({
      status: 'payment_submitted',
      expires_at: own.expires_at,
      slot_start: '2030-01-07T15:00:00.000Z',
      slot_end: '2030-01-07T17:00:00.000Z',
      courts: 1,
    })
  })

  it('with no active court returns the first court’s values and 0 courts', () => {
    const a = groupCourt({ status: 'cancelled', slot_start: '2030-01-06T23:00:00.000Z', slot_end: '2030-01-07T00:00:00.000Z' })
    const b = groupCourt({ reference_code: 'CB-PART02', status: 'cancelled', slot_start: '2030-01-07T15:00:00.000Z', slot_end: '2030-01-07T17:00:00.000Z' })
    expect(groupCancelInput(own, [a, b], NOW)).toEqual({
      status: 'cancelled',
      expires_at: own.expires_at,
      slot_start: a.slot_start,
      slot_end: a.slot_end,
      courts: 0,
    })
  })

  it('feeds playerCancel: the deadline is measured at the earliest active start, and a closed group has none', () => {
    // Earliest active start 7 AM Manila (23:00Z); the venue's cutoff is 1 hour.
    const check = playerCancel(groupCancelInput(own, [early, late], NOW), 1, NOW)
    expect(check).toEqual({ kind: 'allowed', deadline: new Date('2030-01-06T22:00:00.000Z') })
    // Inside the cutoff of the earliest court: closed for the whole group, even though the later court is far off.
    expect(playerCancel(groupCancelInput(own, [early, late], new Date('2030-01-06T22:30:00.000Z')), 1, new Date('2030-01-06T22:30:00.000Z')))
      .toEqual({ kind: 'closed', deadline: new Date('2030-01-06T22:00:00.000Z') })
    expect(playerCancel(groupCancelInput(own, [groupCourt({ status: 'cancelled' })], NOW), 1, NOW)).toEqual({ kind: 'not_active' })
  })
})
