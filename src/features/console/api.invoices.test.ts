// T14.10: invoice review goes through the invoices_overview, invoice_detail, mark_invoice_sent and mark_invoice_paid RPCs.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }))

const { fetchInvoicesOverview, fetchInvoiceDetail, markInvoiceSent, markInvoicePaid } = await import('./api')

const failure = { data: null, error: { message: 'x', details: '', hint: 'invalid_status', code: 'P0001', name: 'PostgrestError' } }

beforeEach(() => { rpc.mockReset() })

describe('invoice review api', () => {
  it('fetchInvoicesOverview calls invoices_overview and returns the array as is', async () => {
    const rows = [{ invoice_id: 'i1', slug: 'e2e-a', name: 'E2E A', billing_month: '2026-03-01', status: 'sent', total: 20.5, overdue: true }]
    rpc.mockResolvedValue({ data: rows, error: null })
    expect(await fetchInvoicesOverview()).toEqual(rows)
    expect(rpc).toHaveBeenCalledWith('invoices_overview')
  })

  it('fetchInvoicesOverview returns an empty array when the RPC returns none', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    expect(await fetchInvoicesOverview()).toEqual([])
  })

  it('fetchInvoiceDetail calls invoice_detail with p_invoice_id and returns the object', async () => {
    const detail = { invoice_id: 'i1', lines: [] }
    rpc.mockResolvedValue({ data: detail, error: null })
    expect(await fetchInvoiceDetail('i1')).toEqual(detail)
    expect(rpc).toHaveBeenCalledWith('invoice_detail', { p_invoice_id: 'i1' })
  })

  it('markInvoiceSent calls mark_invoice_sent with p_invoice_id', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await markInvoiceSent('i1')
    expect(rpc).toHaveBeenCalledWith('mark_invoice_sent', { p_invoice_id: 'i1' })
  })

  it('markInvoicePaid calls mark_invoice_paid with method and reference', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await markInvoicePaid({ invoiceId: 'i1', method: 'GCash', reference: 'TX-1' })
    expect(rpc).toHaveBeenCalledWith('mark_invoice_paid', { p_invoice_id: 'i1', p_method: 'GCash', p_reference: 'TX-1' })
  })

  it('markInvoiceSent and markInvoicePaid reject when the RPC fails', async () => {
    rpc.mockResolvedValue(failure)
    await expect(markInvoiceSent('i1')).rejects.toBeTruthy()
    await expect(markInvoicePaid({ invoiceId: 'i1', method: 'GCash', reference: '' })).rejects.toBeTruthy()
  })

  it('fetchInvoiceDetail rejects when the RPC fails', async () => {
    rpc.mockResolvedValue(failure)
    await expect(fetchInvoiceDetail('i1')).rejects.toBeTruthy()
  })
})
