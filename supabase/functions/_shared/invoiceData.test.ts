import { describe, expect, it } from 'vitest'
import { addDays, imageKind, invoiceItems, invoicePdfData, localDate, recipientName, type InvoiceRows } from './invoiceData.ts'

// Builder's tests for T26.4: the PDF's data from the invoice rows.
const rows: InvoiceRows = {
  invoice: { billing_month: '2026-10-01', status: 'sent', sent_at: '2026-11-02T18:30:00Z' },
  slug: 'claudex-courts',
  venueName: 'Claudex Courts',
  address: '12 Rizal Avenue',
  timezone: 'Asia/Manila',
  graceDays: 7,
  charges: [
    ...Array.from({ length: 3 }, () => ({ kind: 'booking_fee', amount: '10.00' })),
    { kind: 'booking_fee', amount: 15 },
    { kind: 'adjustment', amount: '-10.00' },
  ],
  ownerNames: ['Maria Santos'],
  accounts: [],
  supportEmail: 'support@plotline.fit',
  now: new Date('2026-11-13T04:00:00Z'),
}

describe('invoiceItems', () => {
  it('groups fees and credits by amount', () => {
    expect(invoiceItems(rows.charges)).toEqual([
      { description: 'Booking fees', quantity: 3, rate: 10, amount: 30 },
      { description: 'Booking fees', quantity: 1, rate: 15, amount: 15 },
      { description: 'Venue cancellations credited', quantity: 1, rate: -10, amount: -10 },
    ])
  })
  it('is empty without charges', () => expect(invoiceItems([])).toEqual([]))
})

describe('invoicePdfData', () => {
  it('numbers, totals and dates a sent invoice in the venue timezone', () => {
    const d = invoicePdfData(rows)
    expect(d.number).toBe('CLAUDEX-COURTS-202610')
    expect(d.invoiceDate).toBe('2026-11-03') // 18:30 UTC is 02:30 the next day in Manila
    expect(d.dueDate).toBe('2026-11-10')
    expect([d.subTotal, d.total, d.balanceDue]).toEqual([35, 35, 35])
    expect(d.ownerName).toBe('Maria Santos')
  })
  it('dates a draft today and zeroes a paid balance', () => {
    expect(invoicePdfData({ ...rows, invoice: { ...rows.invoice, status: 'draft', sent_at: null } }).invoiceDate).toBe('2026-11-13')
    expect(invoicePdfData({ ...rows, invoice: { ...rows.invoice, status: 'paid' } }).balanceDue).toBe(0)
  })
  it('joins several owner names and leaves it null without names', () => {
    expect(invoicePdfData({ ...rows, ownerNames: ['Zed', null, 'Ana'] }).ownerName).toBe('Ana, Zed')
    expect(invoicePdfData({ ...rows, ownerNames: [null] }).ownerName).toBeNull()
  })
})

describe('helpers', () => {
  it('recipientName uses the single owner name, else the venue', () => {
    expect(recipientName(['Maria'], 'Claudex')).toBe('Maria')
    expect(recipientName([null], 'Claudex')).toBe('Claudex')
    expect(recipientName(['Maria', 'Ana'], 'Claudex')).toBe('Claudex')
  })
  it('localDate falls back to Manila for an unknown zone; addDays crosses months', () => {
    expect(localDate(new Date('2026-11-02T18:30:00Z'), 'Not/AZone')).toBe('2026-11-03')
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04')
  })
  it('imageKind reads PNG and JPEG magic bytes only', () => {
    expect(imageKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0]))).toBe('png')
    expect(imageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
    expect(imageKind(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57]))).toBeNull()
  })
})
