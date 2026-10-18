import { describe, expect, it } from 'vitest'
import type { AdminPayment } from './api'
import { hasPaidOnline, onlinePayments, paymentFlags, sourceLabel } from './paymentFlags'

const payment = (overrides: Partial<AdminPayment>): AdminPayment => ({
  id: 'p', method: 'gcash', amount: 900, reference_number: null, storage_path: null, submitted_at: '2030-01-07T02:00:00.000Z',
  review_status: 'pending', review_note: null, reviewed_at: null, reviewed_by: null, provider_payment_id: null, provider_source: null,
  ...overrides,
})
const online = (review_status: AdminPayment['review_status']) =>
  payment({ id: `pm-${review_status}`, method: 'paymongo', review_status, provider_payment_id: 'pay_1', provider_source: 'gcash' })

describe('paymentFlags', () => {
  it('flags a PayMongo payment that was received but not accepted', () => {
    const late = online('rejected')
    expect(paymentFlags({ payments: [late] })).toEqual({ refundDue: [late], supersededProofs: [] })
  })

  it('flags a proof the webhook closed because the customer paid online', () => {
    const closed = payment({ id: 'proof', review_status: 'rejected', review_note: 'Paid online with PayMongo instead.' })
    expect(paymentFlags({ payments: [closed, online('approved')] }).supersededProofs).toEqual([closed])
  })

  it("doesn't flag a staff rejection whose reviewer was deleted (reviewed_by set to null)", () => {
    const orphaned = payment({ review_status: 'rejected', review_note: 'Blurry', reviewed_by: null })
    expect(paymentFlags({ payments: [orphaned] }).supersededProofs).toEqual([])
  })

  it("doesn't flag a proof staff rejected, an accepted online payment, or a pending proof", () => {
    const flags = paymentFlags({ payments: [
      payment({ review_status: 'rejected', review_note: 'Blurry', reviewed_by: 'admin-1' }),
      online('approved'),
      payment({ id: 'pending' }),
    ] })
    expect(flags).toEqual({ refundDue: [], supersededProofs: [] })
  })
})

describe('online payment helpers', () => {
  it('finds online payments and whether one was accepted', () => {
    const bookingPayments = [payment({}), online('approved')]
    expect(onlinePayments({ payments: bookingPayments })).toHaveLength(1)
    expect(hasPaidOnline({ payments: bookingPayments })).toBe(true)
    expect(hasPaidOnline({ payments: [online('rejected')] })).toBe(false)
  })

  it('labels PayMongo sources for staff', () => {
    expect(sourceLabel('paymaya')).toBe('Maya')
    expect(sourceLabel('qrph')).toBe('QR Ph')
    expect(sourceLabel('shopee_pay')).toBe('shopee_pay')
    expect(sourceLabel(null)).toBeNull()
  })
})
