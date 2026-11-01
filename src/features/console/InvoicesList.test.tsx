// T14.10: the invoices list shows every invoice with its number, venue, status, PHP total and an Overdue flag; Review opens the detail.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InvoiceDetailData, InvoiceOverview } from './api'

vi.mock('./api', () => ({
  fetchInvoicesOverview: vi.fn(), fetchInvoiceDetail: vi.fn(), markInvoiceSent: vi.fn(), markInvoicePaid: vi.fn(),
  fetchVenuesOverview: vi.fn(), suspendVenue: vi.fn(), reactivateVenue: vi.fn(), fetchIsPlatformAdmin: vi.fn(),
  fetchLeads: vi.fn(), updateLead: vi.fn(),
}))

const { fetchInvoicesOverview, fetchInvoiceDetail } = await import('./api')
const { InvoicesList } = await import('./InvoicesList')

function invoice(over: Partial<InvoiceOverview> = {}): InvoiceOverview {
  return {
    invoice_id: 'i1', venue_id: 'v1', slug: 'e2e-alpha', name: 'E2E Alpha Courts', billing_month: '2026-03-01', status: 'draft',
    sent_at: null, paid_at: null, paid_method: null, paid_reference: null,
    fee_count: 2, fee_total: 25.5, adjustment_total: -5, total: 20.5, due_at: null, overdue: false, ...over,
  }
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><InvoicesList /></QueryClientProvider>)
}

beforeEach(() => {
  vi.mocked(fetchInvoicesOverview).mockReset()
  vi.mocked(fetchInvoiceDetail).mockReset()
})

describe('InvoicesList', () => {
  it('has an Invoices heading', async () => {
    vi.mocked(fetchInvoicesOverview).mockResolvedValue([])
    renderList()
    expect(screen.getByRole('heading', { name: 'Invoices' })).toBeInTheDocument()
    await screen.findByText(/no invoices/i)
  })

  it('shows a loading state while the invoices load', () => {
    vi.mocked(fetchInvoicesOverview).mockReturnValue(new Promise(() => {}))
    renderList()
    expect(screen.getByText(/loading invoices/i)).toBeInTheDocument()
  })

  it('shows an empty state when there are no invoices', async () => {
    vi.mocked(fetchInvoicesOverview).mockResolvedValue([])
    renderList()
    expect(await screen.findByText(/no invoices yet/i)).toBeInTheDocument()
  })

  it('shows an error with a Retry button that loads again', async () => {
    vi.mocked(fetchInvoicesOverview).mockRejectedValueOnce(new Error('boom')).mockResolvedValue([invoice()])
    renderList()
    expect(await screen.findByText(/couldn't load invoices/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('E2E Alpha Courts')).toBeInTheDocument()
  })

  it('lists each invoice with its number, venue name, status and PHP total', async () => {
    vi.mocked(fetchInvoicesOverview).mockResolvedValue([
      invoice(),
      invoice({ invoice_id: 'i2', slug: 'e2e-bravo', name: 'E2E Bravo', billing_month: '2025-12-01', status: 'paid', total: 1234.5 }),
    ])
    renderList()
    await screen.findByText('E2E Alpha Courts')
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    const first = within(items[0])
    expect(first.getByText(/E2E-ALPHA-202603/)).toBeInTheDocument()
    expect(first.getByText(/draft/i)).toBeInTheDocument()
    expect(first.getByText(/₱\s?20\.50/)).toBeInTheDocument()
    const second = within(items[1])
    expect(second.getByText(/E2E-BRAVO-202512/)).toBeInTheDocument()
    expect(second.getByText('E2E Bravo')).toBeInTheDocument()
    expect(second.getByText(/paid/i)).toBeInTheDocument()
    expect(second.getByText(/₱\s?1,234\.50/)).toBeInTheDocument()
  })

  it('flags only overdue invoices with Overdue', async () => {
    vi.mocked(fetchInvoicesOverview).mockResolvedValue([
      invoice({ invoice_id: 'i1', name: 'Late One', status: 'sent', overdue: true }),
      invoice({ invoice_id: 'i2', name: 'On Time', status: 'sent', overdue: false }),
    ])
    renderList()
    await screen.findByText('Late One')
    const items = screen.getAllByRole('listitem')
    expect(within(items[0]).getByText('Overdue')).toBeInTheDocument()
    expect(within(items[1]).queryByText('Overdue')).not.toBeInTheDocument()
  })

  it('opens the detail of an invoice with its Review button', async () => {
    vi.mocked(fetchInvoicesOverview).mockResolvedValue([invoice()])
    const detail: InvoiceDetailData = { ...invoice(), lines: [] }
    vi.mocked(fetchInvoiceDetail).mockResolvedValue(detail)
    renderList()
    await userEvent.click(await screen.findByRole('button', { name: /review/i }))
    expect(fetchInvoiceDetail).toHaveBeenCalledWith('i1')
    expect(await screen.findByText('Statement of amounts; not a tax invoice.')).toBeInTheDocument()
  })
})
