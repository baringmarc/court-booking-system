// T30.6: what a player is shown about a refund: parsing get_guest_booking.refund / get_own_booking_refund (never the
// staff note) and the sentence for each status.
import { describe, expect, it } from 'vitest'
import { parsePlayerRefund, refundMessage, type PlayerRefund } from './refund'

describe('parsePlayerRefund', () => {
  it('reads an owed refund', () => {
    expect(parsePlayerRefund({ status: 'owed', amount: 350, method: null, settled_on: null, reason: null })).toEqual({
      status: 'owed', amount: 350, method: null, settled_on: null, reason: null,
    })
  })

  it('reads a settled refund and a not-refunded one', () => {
    expect(parsePlayerRefund({ status: 'settled', amount: 350, method: 'gcash', settled_on: '2030-01-07', reason: null })).toEqual({
      status: 'settled', amount: 350, method: 'gcash', settled_on: '2030-01-07', reason: null,
    })
    expect(parsePlayerRefund({ status: 'not_refunded', amount: 350, method: null, settled_on: null, reason: 'Court was flooded' })).toEqual({
      status: 'not_refunded', amount: 350, method: null, settled_on: null, reason: 'Court was flooded',
    })
  })

  it('turns an amount that arrives as a string into a number', () => {
    expect(parsePlayerRefund({ status: 'owed', amount: '350.50', method: null, settled_on: null, reason: null })?.amount).toBe(350.5)
  })

  it('reads missing optional parts as null', () => {
    expect(parsePlayerRefund({ status: 'owed', amount: 350 })).toEqual({ status: 'owed', amount: 350, method: null, settled_on: null, reason: null })
  })

  it('is null for null, undefined, a non-object, an array, or an unknown status', () => {
    for (const json of [null, undefined, 'owed', 5, true, [], [{ status: 'owed', amount: 1 }], {}, { status: 'pending', amount: 350 }, { amount: 350 }] as const) {
      expect(parsePlayerRefund(json as never), JSON.stringify(json)).toBeNull()
    }
  })

  it('drops everything it does not know: the staff note and who recorded it never get through', () => {
    const refund = parsePlayerRefund({
      status: 'settled', amount: 350, method: 'gcash', settled_on: '2030-01-07', reason: null,
      note: 'STAFF ONLY: owner said ok', recorded_by: 'admin-user-id', id: 'r1', payment_id: 'p1',
    }) as PlayerRefund
    expect(Object.keys(refund).sort()).toEqual(['amount', 'method', 'reason', 'settled_on', 'status'])
    expect(JSON.stringify(refund)).not.toMatch(/STAFF ONLY|admin-user-id/)
  })
})

describe('refundMessage', () => {
  const opts = { currency: 'PHP', timeZone: 'Asia/Manila' }
  const refund = (patch: Partial<PlayerRefund>): PlayerRefund => ({ status: 'owed', amount: 350, method: null, settled_on: null, reason: null, ...patch })

  it('says what an owed refund is', () => {
    expect(refundMessage(refund({}), opts)).toBe('The venue owes you a refund of ₱350')
  })

  it('says how much, by what and on which day a settled refund was made', () => {
    expect(refundMessage(refund({ status: 'settled', method: 'gcash', settled_on: '2030-01-07' }), opts)).toBe('Refunded ₱350 by GCash on Mon, Jan 7')
    expect(refundMessage(refund({ status: 'settled', method: 'bank_transfer', settled_on: '2030-01-01' }), opts)).toBe('Refunded ₱350 by Bank transfer on Tue, Jan 1')
  })

  it('leaves out the method or the date when it is not known', () => {
    expect(refundMessage(refund({ status: 'settled', method: null, settled_on: '2030-01-07' }), opts)).toBe('Refunded ₱350 on Mon, Jan 7')
    expect(refundMessage(refund({ status: 'settled', method: 'cash', settled_on: null }), opts)).toBe('Refunded ₱350 by Cash')
    expect(refundMessage(refund({ status: 'settled' }), opts)).toBe('Refunded ₱350')
  })

  it('gives the reason for no refund', () => {
    expect(refundMessage(refund({ status: 'not_refunded', reason: 'Court was flooded' }), opts)).toBe('No refund: Court was flooded')
  })

  it('writes centavos, and the venue currency', () => {
    expect(refundMessage(refund({ amount: 150.5 }), opts)).toBe('The venue owes you a refund of ₱150.50')
    expect(refundMessage(refund({}), { currency: 'USD', timeZone: 'Asia/Manila' })).toMatch(/^The venue owes you a refund of .*350$/)
  })

  it('ends without a period', () => {
    for (const r of [refund({}), refund({ status: 'settled', method: 'gcash', settled_on: '2030-01-07' }), refund({ status: 'not_refunded', reason: 'Played' })]) {
      expect(refundMessage(r, opts).endsWith('.')).toBe(false)
    }
  })
})
