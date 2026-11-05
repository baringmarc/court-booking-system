// T17.21: the paged statement api names the page's venue, turns a 1-based page into limit/offset (25 per page) and
// returns the RPC's JSON as is.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  VENUE: 'a0000000-0000-0000-0000-00000000000a',
  calls: [] as { fn: string; args: unknown }[],
  result: { data: null as unknown, error: null as { message: string; code?: string } | null },
}))

vi.mock('../../lib/currentVenue', () => ({ currentVenueId: () => h.VENUE }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      h.calls.push({ fn, args })
      return Promise.resolve(h.result)
    },
  },
}))

import { fetchStatementCharges, fetchStatementInvoices, fetchStatementSummary } from './api'

const summary = {
  month: '2026-11-01',
  fee_count: 2,
  fee_total: 20,
  adjustment_total: -10,
  total: 10,
  by_method: [{ method: 'account', paid_with: 'BPI', count: 2, fee_total: 20 }],
  accrual: { fee_count: 2, fee_total: 20, adjustment_total: -10, total: 10 },
  amount_due: {
    total: 30,
    count: 1,
    invoices: [{ invoice_id: 'i1', billing_month: '2026-10-01', total: 30, sent_at: '2026-11-01T00:00:00+00:00', due_at: '2026-11-08T00:00:00+00:00', overdue: false }],
  },
}
const chargesPage = {
  total: 1,
  rows: [{ charge_id: 'c1', booking_id: 'b1', reference_code: 'CB-AAAAAA', kind: 'booking_fee', amount: 10, charged_at: '2026-11-02T01:00:00+00:00', invoice_id: 'i1' }],
}
const invoicesPage = {
  total: 1,
  rows: [{ invoice_id: 'i1', billing_month: '2026-10-01', status: 'sent', fee_total: 30, adjustment_total: 0, total: 30, sent_at: '2026-11-01T00:00:00+00:00', due_at: '2026-11-08T00:00:00+00:00', overdue: false, paid_at: null, paid_method: null, paid_reference: null }],
}

describe('paged statement api', () => {
  beforeEach(() => {
    h.calls.length = 0
    h.result = { data: null, error: null }
  })

  it('fetchStatementSummary calls statement_summary with the current venue and no month by default', async () => {
    h.result = { data: summary, error: null }
    await expect(fetchStatementSummary()).resolves.toEqual(summary)
    expect(h.calls).toEqual([{ fn: 'statement_summary', args: { p_venue_id: h.VENUE, p_month: null } }])
  })

  it('fetchStatementSummary sends the chosen month', async () => {
    h.result = { data: summary, error: null }
    await fetchStatementSummary('2026-09-01')
    expect(h.calls).toEqual([{ fn: 'statement_summary', args: { p_venue_id: h.VENUE, p_month: '2026-09-01' } }])
  })

  it('fetchStatementSummary throws the database error message', async () => {
    h.result = { data: null, error: { message: 'Only staff of this venue can do this.', code: 'P0001' } }
    await expect(fetchStatementSummary()).rejects.toThrow('Only staff of this venue can do this.')
  })

  it('fetchStatementCharges page 1 asks for 25 rows from offset 0 and returns the page', async () => {
    h.result = { data: chargesPage, error: null }
    await expect(fetchStatementCharges({ month: '2026-11-01', search: 'CB-AAA', page: 1 })).resolves.toEqual(chargesPage)
    expect(h.calls).toEqual([
      { fn: 'statement_charges_page', args: { p_venue_id: h.VENUE, p_month: '2026-11-01', p_search: 'CB-AAA', p_limit: 25, p_offset: 0 } },
    ])
  })

  it('fetchStatementCharges page 3 asks for offset 50', async () => {
    h.result = { data: chargesPage, error: null }
    await fetchStatementCharges({ page: 3 })
    expect(h.calls[0].args).toMatchObject({ p_venue_id: h.VENUE, p_limit: 25, p_offset: 50 })
  })

  it('fetchStatementCharges sends a blank search and a missing month as null', async () => {
    h.result = { data: chargesPage, error: null }
    await fetchStatementCharges({ month: null, search: '   ', page: 1 })
    expect(h.calls[0].args).toMatchObject({ p_month: null, p_search: null })
  })

  it('fetchStatementCharges treats a page below 1 as page 1', async () => {
    h.result = { data: chargesPage, error: null }
    await fetchStatementCharges({ page: 0 })
    expect(h.calls[0].args).toMatchObject({ p_offset: 0 })
  })

  it('fetchStatementCharges throws the database error message', async () => {
    h.result = { data: null, error: { message: 'invalid_input', code: 'P0001' } }
    await expect(fetchStatementCharges({ page: 1 })).rejects.toThrow('invalid_input')
  })

  it('fetchStatementInvoices page 2 with a status asks for offset 25 and returns the page', async () => {
    h.result = { data: invoicesPage, error: null }
    await expect(fetchStatementInvoices({ status: 'sent', page: 2 })).resolves.toEqual(invoicesPage)
    expect(h.calls).toEqual([
      { fn: 'statement_invoices_page', args: { p_venue_id: h.VENUE, p_status: 'sent', p_limit: 25, p_offset: 25 } },
    ])
  })

  it('fetchStatementInvoices sends a blank status as null', async () => {
    h.result = { data: invoicesPage, error: null }
    await fetchStatementInvoices({ status: '', page: 1 })
    expect(h.calls[0].args).toEqual({ p_venue_id: h.VENUE, p_status: null, p_limit: 25, p_offset: 0 })
  })

  it('fetchStatementInvoices throws the database error message', async () => {
    h.result = { data: null, error: { message: 'invalid_filter', code: 'P0001' } }
    await expect(fetchStatementInvoices({ status: 'bogus', page: 1 })).rejects.toThrow('invalid_filter')
  })
})
