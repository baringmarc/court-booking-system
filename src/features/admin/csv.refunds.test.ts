// T30.6: the payments CSV carries each payment's refund: status, amount, method, date and reason.
import { describe, expect, it } from 'vitest'
import type { ExportPayment } from './api'
import { paymentsCsv } from './csv'

const TZ = 'Asia/Manila'
const lines = (text: string) => text.replace(/^\uFEFF/, '').split('\r\n')
const base: ExportPayment = {
  booking_reference: 'CB-ABC234', method: 'gcash', amount: 350, reference_number: '1234 5678',
  received_at: '2026-10-25T03:15:00.000Z', review_status: 'approved', refund: null,
}
const csv = (payments: ExportPayment[], currency = 'PHP') => lines(paymentsCsv(payments, { timeZone: TZ, currency }))

describe('paymentsCsv refund columns (T30.6)', () => {
  it('adds five refund columns after status, the amount named for the currency', () => {
    expect(csv([], 'PHP')[0]).toBe(
      '"booking reference","method","amount_php","reference number","received (Asia/Manila)","status","refund status","refund_amount_php","refund method","refunded on","refund reason"',
    )
    expect(csv([], 'USD')[0]).toContain('"refund_amount_usd"')
  })

  it('writes a settled refund with its method label, amount and date', () => {
    const [, row] = csv([{ ...base, refund: { status: 'settled', amount: 350, method: 'gcash', settled_on: '2026-10-26', reason: null } }])
    expect(row).toBe('"CB-ABC234","GCash","350","1234 5678","2026-10-25 11:15","Accepted","Refunded","350","GCash","2026-10-26",""')
  })

  it('writes a part refund with centavos and a bank-transfer label', () => {
    const [, row] = csv([{ ...base, refund: { status: 'settled', amount: 150.5, method: 'bank_transfer', settled_on: '2026-10-26', reason: null } }])
    expect(row).toContain('"Refunded","150.5","Bank transfer","2026-10-26",""')
  })

  it('writes an owed refund with no method or date', () => {
    const [, row] = csv([{ ...base, refund: { status: 'owed', amount: 350, method: null, settled_on: null, reason: null } }])
    expect(row).toBe('"CB-ABC234","GCash","350","1234 5678","2026-10-25 11:15","Accepted","Refund owed","350","","",""')
  })

  it('leaves the method empty unless the refund is settled', () => {
    const [, owed, notRefunded] = csv([
      { ...base, refund: { status: 'owed', amount: 350, method: 'gcash', settled_on: null, reason: null } },
      { ...base, refund: { status: 'not_refunded', amount: 350, method: 'cash', settled_on: null, reason: 'Played the full hour' } },
    ])
    expect(owed).toContain('"Refund owed","350","","",""')
    expect(notRefunded).toContain('"Not refunded","350","","","Played the full hour"')
  })

  it('writes a not-refunded reason, and defuses one that starts like a formula', () => {
    const [, plain, formula] = csv([
      { ...base, refund: { status: 'not_refunded', amount: 350, method: null, settled_on: null, reason: 'Court was flooded' } },
      { ...base, refund: { status: 'not_refunded', amount: 350, method: null, settled_on: null, reason: '=HYPERLINK("x")' } },
    ])
    expect(plain.endsWith('"Court was flooded"')).toBe(true)
    expect(formula.endsWith(`"'=HYPERLINK(""x"")"`)).toBe(true)
  })

  it('quotes a reason with commas and quotes', () => {
    const [, row] = csv([{ ...base, refund: { status: 'not_refunded', amount: 350, method: null, settled_on: null, reason: 'Rain, "heavy"' } }])
    expect(row.endsWith('"Rain, ""heavy"""')).toBe(true)
  })

  it('says Not accepted for a payment that was not approved, with its refund beside it', () => {
    const [, row] = csv([{
      ...base, method: 'paymongo', review_status: 'rejected', reference_number: null,
      refund: { status: 'owed', amount: 350, method: null, settled_on: null, reason: null },
    }])
    expect(row).toBe('"CB-ABC234","PayMongo","350","","2026-10-25 11:15","Not accepted","Refund owed","350","","",""')
    expect(row).not.toContain('Refund due')
  })

  it('keeps a row per payment, with and without a refund', () => {
    const rows = csv([base, { ...base, booking_reference: 'CB-ZZZ999', refund: { status: 'settled', amount: 350, method: 'cash', settled_on: '2026-10-25', reason: null } }])
    expect(rows).toHaveLength(4)
    expect(rows[1].endsWith('"Accepted","","","","",""')).toBe(true)
    expect(rows[2]).toContain('"Refunded","350","Cash","2026-10-25"')
  })
})
