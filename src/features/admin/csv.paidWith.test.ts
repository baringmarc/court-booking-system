// T11.28: the payments CSV names the payment account used.
import { describe, expect, it } from 'vitest'
import type { ExportPayment } from './api'
import { paymentsCsv } from './csv'

const lines = (text: string) => text.replace(/^\uFEFF/, '').split('\r\n')
const base: ExportPayment = {
  booking_reference: 'CB-ABC234', method: 'account', paid_with: 'BPI Savings', amount: 350, reference_number: '1234',
  received_at: '2026-10-25T03:15:00.000Z', review_status: 'approved',
}

describe('paymentsCsv paid with', () => {
  it('writes paid_with in the method column, else the method label', () => {
    const text = paymentsCsv([base, { ...base, method: 'maya', paid_with: null }], { timeZone: 'Asia/Manila', currency: 'PHP' })
    const rows = lines(text)
    expect(rows[1]).toBe('"CB-ABC234","BPI Savings","350","1234","2026-10-25 11:15","Accepted"')
    expect(rows[2]).toBe('"CB-ABC234","Maya","350","1234","2026-10-25 11:15","Accepted"')
  })
})
