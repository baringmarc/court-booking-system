import { describe, expect, it } from 'vitest'
import { invoiceAccess, invoiceNumber, parseInvoiceBody } from './invoiceRequest.ts'

const ID = '3f2b8c1e-9d4a-4c55-8a1b-0123456789ab'

describe('parseInvoiceBody', () => {
  it.each(['pdf', 'send'] as const)('accepts action %s', (action) => {
    expect(parseInvoiceBody({ invoice_id: ID, action })).toEqual({ ok: true, invoiceId: ID, action })
  })
  it('accepts an uppercase UUID', () => {
    const up = ID.toUpperCase()
    expect(parseInvoiceBody({ invoice_id: up, action: 'pdf' })).toEqual({ ok: true, invoiceId: up, action: 'pdf' })
  })
  it.each([
    [{ action: 'pdf' }],
    [{ invoice_id: ID }],
    [{ invoice_id: 42, action: 'pdf' }],
    [{ invoice_id: 'not-a-uuid', action: 'pdf' }],
    [{ invoice_id: `${ID}x`, action: 'pdf' }],
    [{ invoice_id: '', action: 'pdf' }],
    [{ invoice_id: ID, action: 'delete' }],
    [{ invoice_id: ID, action: 'PDF' }],
    [{ invoice_id: ID, action: ['pdf'] }],
    [{ invoice_id: ID, action: null }],
    [null],
    [undefined],
    ['pdf'],
    [42],
    [[]],
  ])('rejects %j', (raw) => {
    expect(parseInvoiceBody(raw)).toEqual({ ok: false })
  })
})

describe('invoiceNumber', () => {
  it('is the upper-cased slug and YYYYMM', () => {
    expect(invoiceNumber('claudex-courts', '2026-10-01')).toBe('CLAUDEX-COURTS-202610')
  })
  it('keeps a zero-padded month and crosses a year', () => {
    expect(invoiceNumber('a', '2027-01-01')).toBe('A-202701')
  })
})

type Input = Parameters<typeof invoiceAccess>[0]
const base: Input = {
  action: 'send',
  isPlatformAdmin: true,
  isVenueAdmin: false,
  status: 'draft',
  accountCount: 1,
  ownerCount: 1,
}
const refusal = (r: ReturnType<typeof invoiceAccess>) => {
  if (r.ok) throw new Error('expected a refusal')
  expect(r.message.length).toBeGreaterThan(0)
  return { status: r.status, code: r.code }
}

describe('invoiceAccess: pdf', () => {
  const pdf = { ...base, action: 'pdf' as const }
  it.each(['draft', 'sent', 'paid'] as const)('lets a platform admin read a %s invoice', (status) => {
    expect(invoiceAccess({ ...pdf, status })).toEqual({ ok: true })
  })
  it.each(['sent', 'paid'] as const)('lets a venue admin read their %s invoice', (status) => {
    expect(invoiceAccess({ ...pdf, isPlatformAdmin: false, isVenueAdmin: true, status })).toEqual({ ok: true })
  })
  it('refuses a venue admin a draft with 403 forbidden', () => {
    expect(refusal(invoiceAccess({ ...pdf, isPlatformAdmin: false, isVenueAdmin: true, status: 'draft' }))).toEqual({
      status: 403,
      code: 'forbidden',
    })
  })
  it.each(['draft', 'sent', 'paid'] as const)('refuses anyone else a %s invoice with 403 forbidden', (status) => {
    expect(refusal(invoiceAccess({ ...pdf, isPlatformAdmin: false, isVenueAdmin: false, status }))).toEqual({
      status: 403,
      code: 'forbidden',
    })
  })
  it('ignores account and owner counts', () => {
    expect(invoiceAccess({ ...pdf, accountCount: 0, ownerCount: 0 })).toEqual({ ok: true })
  })
})

describe('invoiceAccess: send', () => {
  it('lets a platform admin send a draft', () => {
    expect(invoiceAccess(base)).toEqual({ ok: true })
  })
  it('lets a platform admin resend a sent invoice', () => {
    expect(invoiceAccess({ ...base, status: 'sent' })).toEqual({ ok: true })
  })
  it('refuses a venue admin with 403 forbidden', () => {
    expect(refusal(invoiceAccess({ ...base, isPlatformAdmin: false, isVenueAdmin: true, status: 'sent' }))).toEqual({
      status: 403,
      code: 'forbidden',
    })
  })
  it('refuses a stranger with 403 forbidden', () => {
    expect(refusal(invoiceAccess({ ...base, isPlatformAdmin: false }))).toEqual({ status: 403, code: 'forbidden' })
  })
  it('treats a platform admin who is also a venue admin as a platform admin', () => {
    expect(invoiceAccess({ ...base, isVenueAdmin: true })).toEqual({ ok: true })
  })
  it('refuses a paid invoice with 409 invalid_status', () => {
    expect(refusal(invoiceAccess({ ...base, status: 'paid' }))).toEqual({ status: 409, code: 'invalid_status' })
  })
  it('refuses with no payment accounts as 409 billing_details_missing', () => {
    expect(refusal(invoiceAccess({ ...base, accountCount: 0 }))).toEqual({
      status: 409,
      code: 'billing_details_missing',
    })
  })
  it('refuses with no owners as 409 no_recipients', () => {
    expect(refusal(invoiceAccess({ ...base, ownerCount: 0 }))).toEqual({ status: 409, code: 'no_recipients' })
  })
  it('checks paid before accounts, and accounts before owners', () => {
    expect(refusal(invoiceAccess({ ...base, status: 'paid', accountCount: 0, ownerCount: 0 })).code).toBe('invalid_status')
    expect(refusal(invoiceAccess({ ...base, accountCount: 0, ownerCount: 0 })).code).toBe('billing_details_missing')
  })
  it('checks forbidden before invalid_status', () => {
    expect(
      refusal(invoiceAccess({ ...base, isPlatformAdmin: false, status: 'paid', accountCount: 0, ownerCount: 0 })).code,
    ).toBe('forbidden')
  })
})
