import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PaymentAttempt } from './api'
import {
  CONFIRM_TIMEOUT_MS,
  paymongoReturnState,
  readPaidParam,
  readReturnState,
  recallCheckoutStart,
  recallGuestToken,
  rememberCheckoutStart,
  returnPollMs,
  rememberGuestToken,
  tokenToRestore,
} from './paymongoReturn'

const payment = (method: PaymentAttempt['method'], review_status: PaymentAttempt['review_status']): PaymentAttempt => ({
  id: `${method}-${review_status}`, method, amount: 900, reference_number: null, submitted_at: '2030-01-07T02:00:00.000Z',
  review_status, reviewed_at: null, review_note: null,
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('readPaidParam', () => {
  it('reads the success and cancel returns', () => {
    expect(readPaidParam('?paid=1')).toBe('success')
    expect(readPaidParam('?paid=0')).toBe('cancel')
    expect(readPaidParam('')).toBeNull()
    expect(readPaidParam('?paid=yes')).toBeNull()
  })
})

describe('guest token across the PayMongo redirect', () => {
  it('survives the round trip in this tab, per booking reference', () => {
    rememberGuestToken('cb-7kq2xd', 'secret-token')
    expect(recallGuestToken('CB-7KQ2XD')).toBe('secret-token')
    expect(recallGuestToken('CB-OTHER2')).toBeNull()
  })

  it('is restored only on a PayMongo return without a token in the URL', () => {
    rememberGuestToken('CB-7KQ2XD', 'secret-token')
    expect(tokenToRestore('CB-7KQ2XD', null, 'success')).toBe('secret-token')
    expect(tokenToRestore('CB-7KQ2XD', null, 'cancel')).toBe('secret-token')
    expect(tokenToRestore('CB-7KQ2XD', null, null)).toBeNull()
    expect(tokenToRestore('CB-7KQ2XD', 'from-link', 'success')).toBeNull()
  })

  it('falls back quietly when storage is unavailable (private mode)', () => {
    const denied = () => { throw new Error('denied') }
    vi.stubGlobal('sessionStorage', { getItem: denied, setItem: denied, clear: () => {} })
    expect(() => rememberGuestToken('CB-7KQ2XD', 't')).not.toThrow()
    expect(recallGuestToken('CB-7KQ2XD')).toBeNull()
  })
})

describe('paymongoReturnState', () => {
  const pending = { status: 'pending_payment' as const, payments: [] }

  it('is null when not returning from PayMongo', () => {
    expect(paymongoReturnState(null, pending, 0)).toBeNull()
  })

  it('confirms once the webhook recorded an accepted PayMongo payment', () => {
    expect(paymongoReturnState('success', pending, 1000)).toBe('confirming')
    expect(paymongoReturnState('success', { status: 'confirmed', payments: [payment('paymongo', 'approved')] }, 1000)).toBe('confirmed')
  })

  it('reports a PayMongo payment that was received but not accepted (late)', () => {
    expect(paymongoReturnState('success', { status: 'cancelled', payments: [payment('paymongo', 'rejected')] }, 1000)).toBe('not_accepted')
  })

  it('does not mistake a rejected proof for the online payment', () => {
    expect(paymongoReturnState('success', { status: 'pending_payment', payments: [payment('gcash', 'rejected')] }, 1000)).toBe('confirming')
  })

  it('times out when the webhook takes too long', () => {
    expect(paymongoReturnState('success', pending, CONFIRM_TIMEOUT_MS - 1)).toBe('confirming')
    expect(paymongoReturnState('success', pending, CONFIRM_TIMEOUT_MS)).toBe('timeout')
  })

  it('shows the cancel return only while the booking still waits for payment', () => {
    expect(paymongoReturnState('cancel', pending, 0)).toBe('cancelled')
    expect(paymongoReturnState('cancel', { status: 'confirmed', payments: [payment('paymongo', 'approved')] }, 0)).toBeNull()
    expect(paymongoReturnState('cancel', { status: 'expired', payments: [] }, 0)).toBeNull()
  })
})

describe('returnPollMs', () => {
  it('polls quickly while confirming, keeps polling slowly after the timeout, and stops once settled', () => {
    expect(returnPollMs('confirming')).toBe(3_000)
    expect(returnPollMs('timeout')).toBe(30_000)
    expect(returnPollMs('confirmed')).toBeNull()
    expect(returnPollMs('not_accepted')).toBeNull()
    expect(returnPollMs('cancelled')).toBeNull()
    expect(returnPollMs(null)).toBeNull()
  })
})

describe('readReturnState', () => {
  it('reads the return kept in history state', () => {
    expect(readReturnState({ paymongoReturn: 'success' })).toBe('success')
    expect(readReturnState({ paymongoReturn: 'cancel', justBooked: true })).toBe('cancel')
    expect(readReturnState({ paymongoReturn: 'other' })).toBeNull()
    expect(readReturnState(null)).toBeNull()
  })
})

describe('the return is about this checkout attempt (M7 review follow-up)', () => {
  const at = (iso: string, review_status: PaymentAttempt['review_status']): PaymentAttempt => ({ ...payment('paymongo', review_status), id: iso, submitted_at: iso })
  const startedAt = Date.parse('2030-01-07T03:00:00.000Z')
  const olderLate = at('2030-01-07T02:00:00.000Z', 'rejected')

  it('ignores a not-accepted online payment from an earlier attempt while this one is processing', () => {
    const booking = { status: 'pending_payment' as const, payments: [olderLate] }
    expect(paymongoReturnState('success', booking, 1000, startedAt)).toBe('confirming')
    expect(paymongoReturnState('cancel', booking, 1000, startedAt)).toBe('cancelled')
  })

  it('still reports this attempt being refused, allowing for clock skew', () => {
    const booking = { status: 'pending_payment' as const, payments: [olderLate, at('2030-01-07T02:59:00.000Z', 'rejected')] }
    expect(paymongoReturnState('success', booking, 1000, startedAt)).toBe('not_accepted')
  })

  it('an accepted payment always means confirmed', () => {
    expect(paymongoReturnState('success', { status: 'confirmed', payments: [olderLate, at('2030-01-07T02:30:00.000Z', 'approved')] }, 1000, startedAt)).toBe('confirmed')
  })

  it('without a recorded start (another tab), every online payment counts, as before', () => {
    expect(paymongoReturnState('success', { status: 'pending_payment', payments: [olderLate] }, 1000, null)).toBe('not_accepted')
  })

  it('remembers the start per booking in this tab, and survives storage being unavailable', () => {
    rememberCheckoutStart('cb-7kq2xd', startedAt)
    expect(recallCheckoutStart('CB-7KQ2XD')).toBe(startedAt)
    expect(recallCheckoutStart('CB-OTHER2')).toBeNull()
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
    expect(() => rememberCheckoutStart('CB-7KQ2XD', startedAt)).not.toThrow()
    expect(recallCheckoutStart('CB-7KQ2XD')).toBeNull()
  })
})
