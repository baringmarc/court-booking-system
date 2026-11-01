// T14.10: the invoice detail shows fee and adjustment subtotals, the total and the booking lines; draft -> Mark as sent,
// sent -> Mark as paid form, Print, and the statement footer.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InvoiceDetailData } from './api'

vi.mock('./api', () => ({
  fetchInvoicesOverview: vi.fn(), fetchInvoiceDetail: vi.fn(), markInvoiceSent: vi.fn(), markInvoicePaid: vi.fn(),
  fetchVenuesOverview: vi.fn(), suspendVenue: vi.fn(), reactivateVenue: vi.fn(), fetchIsPlatformAdmin: vi.fn(),
  fetchLeads: vi.fn(), updateLead: vi.fn(),
}))

const { fetchInvoiceDetail, markInvoiceSent, markInvoicePaid } = await import('./api')
const { InvoiceDetail } = await import('./InvoiceDetail')

function detail(over: Partial<InvoiceDetailData> = {}): InvoiceDetailData {
  return {
    invoice_id: 'i1', venue_id: 'v1', slug: 'e2e-alpha', name: 'E2E Alpha Courts', billing_month: '2026-03-01', status: 'draft',
    sent_at: null, paid_at: null, paid_method: null, paid_reference: null,
    fee_count: 2, fee_total: 25.5, adjustment_total: -5, total: 20.5, due_at: null, overdue: false,
    lines: [
      { charge_id: 'c1', booking_id: 'b1', reference_code: 'CB-XXXXAB', kind: 'booking_fee', amount: 15.5, charged_at: '2026-03-05T05:00:00Z' },
      { charge_id: 'c2', booking_id: 'b2', reference_code: 'CB-XXXXCD', kind: 'booking_fee', amount: 10, charged_at: '2026-03-10T05:00:00Z' },
      { charge_id: 'c3', booking_id: 'b3', reference_code: 'CB-XXXXEF', kind: 'adjustment', amount: -5, charged_at: '2026-03-20T05:00:00Z' },
    ],
    ...over,
  }
}

function renderDetail(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><InvoiceDetail invoiceId="i1" onClose={onClose} /></QueryClientProvider>)
  return onClose
}

beforeEach(() => {
  vi.mocked(fetchInvoiceDetail).mockReset().mockResolvedValue(detail())
  vi.mocked(markInvoiceSent).mockReset().mockResolvedValue(undefined)
  vi.mocked(markInvoicePaid).mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('InvoiceDetail', () => {
  it('shows a loading state, then an error with Retry when the detail fails', async () => {
    vi.mocked(fetchInvoiceDetail).mockRejectedValueOnce(new Error('boom')).mockResolvedValue(detail())
    renderDetail()
    expect(screen.getByText(/loading invoice/i)).toBeInTheDocument()
    expect(await screen.findByText(/couldn't load invoice/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Statement of amounts; not a tax invoice.')).toBeInTheDocument()
  })

  it('shows the fee count and subtotal, the adjustments subtotal and the total in PHP', async () => {
    renderDetail()
    await screen.findByText('CB-XXXXAB')
    expect(screen.getByText(/2 booking fees?/i)).toBeInTheDocument()
    expect(screen.getAllByText(/₱\s?25\.50/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/-\s?₱\s?5\.00|₱\s?-5\.00|−\s?₱\s?5\.00/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/₱\s?20\.50/).length).toBeGreaterThan(0)
  })

  it('lists every line with its booking reference code as a link', async () => {
    renderDetail()
    for (const code of ['CB-XXXXAB', 'CB-XXXXCD', 'CB-XXXXEF']) {
      expect(await screen.findByRole('link', { name: code })).toBeInTheDocument()
    }
  })

  it('shows the statement footer text', async () => {
    renderDetail()
    expect(await screen.findByText('Statement of amounts; not a tax invoice.')).toBeInTheDocument()
  })

  it('shows Mark as sent on a draft, calls it with the invoice id and offers no paid form', async () => {
    renderDetail()
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as sent' }))
    expect(markInvoiceSent).toHaveBeenCalledWith('i1')
    expect(screen.queryByRole('button', { name: 'Mark as paid' })).not.toBeInTheDocument()
  })

  it('on a sent invoice shows the paid form and no Mark as sent, and submits method and reference', async () => {
    vi.mocked(fetchInvoiceDetail).mockResolvedValue(detail({ status: 'sent', sent_at: '2026-03-31T00:00:00Z' }))
    renderDetail()
    await screen.findByText('CB-XXXXAB')
    expect(screen.queryByRole('button', { name: 'Mark as sent' })).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/method/i), 'GCash')
    await userEvent.type(screen.getByLabelText(/reference/i), 'TX-123')
    await userEvent.click(screen.getByRole('button', { name: 'Mark as paid' }))
    expect(markInvoicePaid).toHaveBeenCalledWith({ invoiceId: 'i1', method: 'GCash', reference: 'TX-123' })
  })

  it('shows neither action on a paid invoice', async () => {
    vi.mocked(fetchInvoiceDetail).mockResolvedValue(detail({ status: 'paid', paid_method: 'GCash' }))
    renderDetail()
    await screen.findByText('CB-XXXXAB')
    expect(screen.queryByRole('button', { name: 'Mark as sent' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark as paid' })).not.toBeInTheDocument()
  })

  it('shows an alert when marking as sent fails', async () => {
    vi.mocked(markInvoiceSent).mockRejectedValue(new Error('invalid_status'))
    renderDetail()
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as sent' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('shows an alert when marking as paid fails', async () => {
    vi.mocked(fetchInvoiceDetail).mockResolvedValue(detail({ status: 'sent', sent_at: '2026-03-31T00:00:00Z' }))
    vi.mocked(markInvoicePaid).mockRejectedValue(new Error('method_required'))
    renderDetail()
    await screen.findByText('CB-XXXXAB')
    await userEvent.click(screen.getByRole('button', { name: 'Mark as paid' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('Print calls window.print', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    renderDetail()
    await userEvent.click(await screen.findByRole('button', { name: 'Print' }))
    expect(print).toHaveBeenCalledTimes(1)
  })

  it('calls onClose from its Close button', async () => {
    const onClose = renderDetail()
    await screen.findByText('CB-XXXXAB')
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the invoice number and venue name', async () => {
    renderDetail()
    const heading = await screen.findByText(/E2E-ALPHA-202603/)
    expect(heading).toBeInTheDocument()
    expect(within(document.body).getByText(/E2E Alpha Courts/)).toBeInTheDocument()
  })
})
