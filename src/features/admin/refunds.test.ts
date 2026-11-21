// T30.6: the pure refund logic behind the admin Refund card (SPEC §4, §6 update_refund).
import { describe, expect, it } from 'vitest'
import type { AdminRefund } from './api'
import { hasOwedRefund, owedRefunds, REFUND_METHODS, REFUND_STATUS_LABELS, validateNotRefunded, validateSettle } from './refunds'

const refund = (overrides: Partial<AdminRefund> = {}): AdminRefund => ({
  id: 'r1', payment_id: 'p1', amount: 900, status: 'owed', method: null, settled_on: null, reason: null, note: null,
  updated_at: '2030-01-07T02:00:00.000Z', ...overrides,
})

describe('labels and methods', () => {
  it('names each refund status for staff', () => {
    expect(REFUND_STATUS_LABELS).toEqual({ owed: 'Refund owed', settled: 'Refunded', not_refunded: 'Not refunded' })
  })

  it('offers the manual methods and PayMongo, never "account"', () => {
    expect(REFUND_METHODS).toEqual(['gcash', 'maya', 'bank_transfer', 'cash', 'paymongo'])
  })
})

describe('owedRefunds / hasOwedRefund', () => {
  it('finds the owed refunds of a booking', () => {
    const owed = refund({ id: 'r2' })
    const booking = { refunds: [refund({ id: 'r1', status: 'settled' }), owed, refund({ id: 'r3', status: 'not_refunded' })] }
    expect(owedRefunds(booking)).toEqual([owed])
    expect(hasOwedRefund(booking)).toBe(true)
  })

  it('has none for settled, not-refunded or no refunds', () => {
    expect(hasOwedRefund({ refunds: [] })).toBe(false)
    expect(owedRefunds({ refunds: [] })).toEqual([])
    expect(hasOwedRefund({ refunds: [refund({ status: 'settled' }), refund({ status: 'not_refunded' })] })).toBe(false)
  })
})

describe('validateSettle', () => {
  const ctx = { paid: 900, today: '2030-01-07', currency: 'PHP' }
  const AMOUNT = 'Enter an amount above 0, up to ₱900.'
  const METHOD = 'Choose how the refund was made.'
  const DATE = 'Choose the date the refund was made, today or earlier.'
  const input = (patch: Partial<{ amount: string; method: string; settledOn: string }> = {}) =>
    ({ amount: '900', method: 'gcash', settledOn: '2030-01-07', ...patch })

  it('accepts the full amount, a method and today, as numbers and a date', () => {
    expect(validateSettle(input(), ctx)).toEqual({ ok: true, value: { amount: 900, method: 'gcash', settledOn: '2030-01-07' } })
  })

  it('accepts a part refund with centavos and an earlier date, and every offered method', () => {
    expect(validateSettle(input({ amount: '450.5', settledOn: '2030-01-05' }), ctx)).toEqual({
      ok: true, value: { amount: 450.5, method: 'gcash', settledOn: '2030-01-05' },
    })
    for (const method of REFUND_METHODS) {
      expect(validateSettle(input({ method }), ctx)).toMatchObject({ ok: true, value: { method } })
    }
  })

  it('rejects a blank, non-numeric, zero, negative or too large amount, naming the most that was paid', () => {
    for (const amount of ['', '   ', 'abc', '0', '-5', '900.01', '1000']) {
      expect(validateSettle(input({ amount }), ctx), `amount "${amount}"`).toEqual({ ok: false, errors: { amount: AMOUNT } })
    }
  })

  it('writes the most that was paid with centavos when it has them', () => {
    expect(validateSettle(input({ amount: '' }), { ...ctx, paid: 350.5 })).toEqual({
      ok: false, errors: { amount: 'Enter an amount above 0, up to ₱350.50.' },
    })
  })

  it('allows two decimals but not more', () => {
    expect(validateSettle(input({ amount: '100.25' }), ctx)).toMatchObject({ ok: true, value: { amount: 100.25 } })
    expect(validateSettle(input({ amount: '100.255' }), ctx)).toEqual({ ok: false, errors: { amount: AMOUNT } })
  })

  it('rejects no method, an unknown one, and "account"', () => {
    for (const method of ['', 'account', 'cheque']) {
      expect(validateSettle(input({ method }), ctx), `method "${method}"`).toEqual({ ok: false, errors: { method: METHOD } })
    }
  })

  it('rejects a blank or malformed date', () => {
    for (const settledOn of ['', '07/01/2030', 'today']) {
      expect(validateSettle(input({ settledOn }), ctx), `date "${settledOn}"`).toEqual({ ok: false, errors: { settledOn: DATE } })
    }
  })

  it('rejects a date after today in the venue, however late or early it is in UTC', () => {
    // Venue date 2030-01-07 can still be 2030-01-06 in UTC (before 8 AM in Manila): the caller passes the venue date.
    expect(validateSettle(input({ settledOn: '2030-01-08' }), ctx)).toEqual({ ok: false, errors: { settledOn: DATE } })
    expect(validateSettle(input({ settledOn: '2030-01-07' }), { ...ctx, today: '2030-01-06' })).toEqual({ ok: false, errors: { settledOn: DATE } })
    expect(validateSettle(input({ settledOn: '2030-01-07' }), { ...ctx, today: '2030-01-07' })).toMatchObject({ ok: true })
  })

  it('reports every problem at once', () => {
    expect(validateSettle({ amount: '', method: '', settledOn: '' }, ctx)).toEqual({
      ok: false, errors: { amount: AMOUNT, method: METHOD, settledOn: DATE },
    })
  })
})

describe('validateNotRefunded', () => {
  it('returns the trimmed reason', () => {
    expect(validateNotRefunded('  Court was flooded  ')).toEqual({ ok: true, value: 'Court was flooded' })
  })

  it('asks for a reason when it is blank after trimming', () => {
    expect(validateNotRefunded('')).toEqual({ ok: false, error: 'Give a reason so the player knows why.' })
    expect(validateNotRefunded('  \n ')).toEqual({ ok: false, error: 'Give a reason so the player knows why.' })
  })

  it('allows 500 characters and asks for fewer above that', () => {
    expect(validateNotRefunded('x'.repeat(500))).toMatchObject({ ok: true })
    expect(validateNotRefunded('x'.repeat(501))).toEqual({ ok: false, error: 'Keep the reason under 500 characters.' })
  })
})
