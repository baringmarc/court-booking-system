import { describe, expect, it } from 'vitest'
import { adminCanCancel, playerCancel } from './cancellation'

const start = '2030-01-07T10:00:00.000Z'
const end = '2030-01-07T12:00:00.000Z'
const booking = (overrides: Partial<{ status: 'pending_payment' | 'payment_submitted' | 'confirmed' | 'cancelled' | 'expired' | 'rejected'; expires_at: string | null }> = {}) => ({
  status: 'confirmed' as const, expires_at: null, slot_start: start, slot_end: end, ...overrides,
})
const at = (iso: string) => new Date(iso)

describe('playerCancel', () => {
  it('allows cancelling before the cutoff and returns the deadline', () => {
    expect(playerCancel(booking(), 1, at('2030-01-07T08:00:00.000Z'))).toEqual({ kind: 'allowed', deadline: at('2030-01-07T09:00:00.000Z') })
  })

  it('still allows it exactly at the deadline', () => {
    expect(playerCancel(booking(), 1, at('2030-01-07T09:00:00.000Z')).kind).toBe('allowed')
  })

  it('closes one millisecond after the deadline', () => {
    expect(playerCancel(booking(), 1, at('2030-01-07T09:00:00.001Z'))).toEqual({ kind: 'closed', deadline: at('2030-01-07T09:00:00.000Z') })
  })

  it('uses the venue cutoff setting', () => {
    expect(playerCancel(booking(), 0, at('2030-01-07T09:59:59.000Z')).kind).toBe('allowed')
    expect(playerCancel(booking(), 24, at('2030-01-06T10:00:01.000Z')).kind).toBe('closed')
  })

  it('treats a live hold and a submitted proof as cancellable', () => {
    const now = at('2030-01-07T08:00:00.000Z')
    expect(playerCancel(booking({ status: 'pending_payment', expires_at: '2030-01-07T08:30:00.000Z' }), 1, now).kind).toBe('allowed')
    expect(playerCancel(booking({ status: 'payment_submitted' }), 1, now).kind).toBe('allowed')
  })

  it('offers nothing for bookings that no longer hold the slot', () => {
    const now = at('2030-01-07T08:00:00.000Z')
    expect(playerCancel(booking({ status: 'pending_payment', expires_at: '2030-01-07T07:59:00.000Z' }), 1, now).kind).toBe('not_active')
    for (const status of ['cancelled', 'expired', 'rejected'] as const) {
      expect(playerCancel(booking({ status }), 1, now).kind).toBe('not_active')
    }
    expect(playerCancel(booking(), 1, at('2030-01-07T12:00:00.000Z')).kind).toBe('not_active') // completed
  })
})

describe('adminCanCancel', () => {
  it('allows admins after the player cutoff and while the booking is in progress', () => {
    expect(adminCanCancel(booking(), at('2030-01-07T09:30:00.000Z'))).toBe(true)
    expect(adminCanCancel(booking(), at('2030-01-07T11:59:59.000Z'))).toBe(true)
  })

  it('stops once the booking has ended or no longer holds the slot', () => {
    expect(adminCanCancel(booking(), at('2030-01-07T12:00:00.000Z'))).toBe(false)
    expect(adminCanCancel(booking({ status: 'cancelled' }), at('2030-01-07T08:00:00.000Z'))).toBe(false)
  })
})
