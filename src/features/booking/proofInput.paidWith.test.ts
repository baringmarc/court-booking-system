// T11.28: the label shown for a payment is the account label it was paid with, else the method's label.
import { describe, expect, it } from 'vitest'
import { paymentLabel } from './proofInput'

describe('paymentLabel', () => {
  it('returns paid_with for an account payment', () => {
    expect(paymentLabel({ method: 'account', paid_with: 'BPI Savings' })).toBe('BPI Savings')
  })

  it('returns paid_with whatever the method, when it is set', () => {
    expect(paymentLabel({ method: 'gcash', paid_with: 'GCash Business' })).toBe('GCash Business')
  })

  it('falls back to the method label when paid_with is null', () => {
    expect(paymentLabel({ method: 'gcash', paid_with: null })).toBe('GCash')
    expect(paymentLabel({ method: 'maya', paid_with: null })).toBe('Maya')
    expect(paymentLabel({ method: 'bank_transfer', paid_with: null })).toBe('Bank transfer')
    expect(paymentLabel({ method: 'cash', paid_with: null })).toBe('Cash')
    expect(paymentLabel({ method: 'paymongo', paid_with: null })).toBe('PayMongo')
  })
})
