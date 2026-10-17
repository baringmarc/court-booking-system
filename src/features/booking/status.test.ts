import { describe, expect, it } from 'vitest'
import { displayStatus } from './status'

const now = new Date('2030-01-07T03:00:00Z')
const base = { slot_end: '2030-01-07T06:00:00Z', expires_at: null }

describe('displayStatus', () => {
  it('shows a pending hold as expired once expires_at has passed (inclusive)', () => {
    expect(displayStatus({ ...base, status: 'pending_payment', expires_at: '2030-01-07T03:00:00Z' }, now)).toBe('expired')
    expect(displayStatus({ ...base, status: 'pending_payment', expires_at: '2030-01-07T03:00:01Z' }, now)).toBe('pending_payment')
  })

  it('shows a confirmed booking as completed after it ends', () => {
    expect(displayStatus({ ...base, status: 'confirmed' }, now)).toBe('confirmed')
    expect(displayStatus({ ...base, status: 'confirmed', slot_end: '2030-01-07T02:00:00Z' }, now)).toBe('completed')
  })

  it('passes other statuses through', () => {
    expect(displayStatus({ ...base, status: 'payment_submitted' }, now)).toBe('payment_submitted')
    expect(displayStatus({ ...base, status: 'cancelled' }, now)).toBe('cancelled')
  })
})
