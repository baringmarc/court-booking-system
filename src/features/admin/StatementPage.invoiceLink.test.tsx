// T26.7: the emailed VIEW INVOICE link (?invoice=<id>) finds the invoice in the history, opens its Details and scrolls to
// it; sent and paid invoices get a Download PDF button (draft ones don't) that saves the PDF from the invoice-pdf function.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'
import {
  fetchStatementCharges, fetchStatementInvoices, fetchStatementSummary,
  type StatementInvoice, type StatementPage as Paged, type StatementSummary,
} from './api'
import { StatementPage } from './StatementPage'

// New in T26.7; a hoisted mock so this file type-checks before the function exists.
const { fetchStatementInvoicePdf } = vi.hoisted(() => ({ fetchStatementInvoicePdf: vi.fn<(invoiceId: string) => Promise<Blob>>() }))

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchStatementSummary: vi.fn(),
  fetchStatementCharges: vi.fn(),
  fetchStatementInvoices: vi.fn(),
  fetchStatementInvoicePdf,
}))
vi.mock('../catalog/hooks', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useVenueSettings: () => ({ data: { timezone: 'Asia/Manila', currency: 'PHP' }, isPending: false, isError: false, error: null, refetch: vi.fn() }),
}))

const summary: StatementSummary = {
  month: '2026-10-01', fee_count: 0, fee_total: 0, adjustment_total: 0, total: 0, by_method: [],
  accrual: { fee_count: 0, fee_total: 0, adjustment_total: 0, total: 0 },
  amount_due: { total: 0, count: 0, invoices: [] },
}

const invoice = (id: string, over: Partial<StatementInvoice>): StatementInvoice => ({
  invoice_id: id, billing_month: '2026-09-01', status: 'draft', fee_total: 0, adjustment_total: 0, total: 0, sent_at: null, due_at: null,
  overdue: false, paid_at: null, paid_method: null, paid_reference: null, ...over,
})
const draft = invoice('i1', { billing_month: '2026-10-01', status: 'draft', fee_total: 90, total: 90 })
const paid = invoice('i2', { billing_month: '2026-07-01', status: 'paid', fee_total: 800, total: 800, sent_at: '2026-08-01T00:00:00+00:00', due_at: '2026-08-08T00:00:00+00:00', paid_at: '2026-08-05T00:00:00+00:00', paid_method: 'GCash', paid_reference: 'R-1' })
const sent = invoice('i3', { billing_month: '2026-08-01', status: 'sent', fee_total: 900, total: 900, sent_at: '2026-09-01T00:00:00+00:00', due_at: '2026-09-08T00:00:00+00:00' })
const small: Paged<StatementInvoice> = { total: 3, rows: [draft, paid, sent] }

// 30 invoices over two pages of 25: fillers (June 2026) first, then the target on page 2 (January 2026).
const fillers = Array.from({ length: 25 }, (_, i) => invoice(`f${i}`, { billing_month: '2026-06-01', status: 'draft' }))
const target = invoice('target-id', { billing_month: '2026-01-01', status: 'sent', fee_total: 123, total: 123, sent_at: '2026-02-01T00:00:00+00:00', due_at: '2026-02-08T00:00:00+00:00' })
const pageTwoRows = [target, ...Array.from({ length: 4 }, (_, i) => invoice(`g${i}`, { billing_month: '2026-05-01', status: 'draft' }))]
const twoPages = ({ page }: { page: number }): Promise<Paged<StatementInvoice>> =>
  Promise.resolve(page === 1 ? { total: 30, rows: fillers } : { total: 30, rows: page === 2 ? pageTwoRows : [] })

function renderPage(url = '/admin/reports') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}><StatementPage /></MemoryRouter></QueryClientProvider>)
}
const historyRows = async () => within(await screen.findByRole('region', { name: /invoice history/i })).findAllByRole('listitem')
const rowFor = async (text: RegExp) => (await historyRows()).find((r) => text.test(r.textContent ?? '')) as HTMLElement

const originalScroll = Element.prototype.scrollIntoView
const urlApi = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown }
const originalCreate = urlApi.createObjectURL
const originalRevoke = urlApi.revokeObjectURL

describe('StatementPage invoice link and PDF download (T26.7)', () => {
  let scroll: ReturnType<typeof vi.fn>
  let create: ReturnType<typeof vi.fn>
  beforeEach(() => {
    setCurrentVenue({ id: 'venue-a', slug: 'a-venue', status: 'active' })
    vi.mocked(fetchStatementSummary).mockReset().mockResolvedValue(summary)
    vi.mocked(fetchStatementCharges).mockReset().mockResolvedValue({ total: 0, rows: [] })
    vi.mocked(fetchStatementInvoices).mockReset().mockResolvedValue(small)
    fetchStatementInvoicePdf.mockReset()
    scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll as unknown as typeof Element.prototype.scrollIntoView
    create = vi.fn(() => 'blob:invoice-1')
    urlApi.createObjectURL = create
    urlApi.revokeObjectURL = vi.fn()
  })
  afterEach(() => {
    Element.prototype.scrollIntoView = originalScroll
    urlApi.createObjectURL = originalCreate
    urlApi.revokeObjectURL = originalRevoke
    vi.restoreAllMocks()
  })

  it('?invoice=<id> on page 1 opens that invoice\'s Details and scrolls to its row', async () => {
    renderPage('/admin/reports?invoice=i3')
    const row = await rowFor(/August 2026/)
    await waitFor(() => expect(within(row).getByRole('button', { name: /details/i })).toHaveAttribute('aria-expanded', 'true'))
    expect(row).toHaveTextContent(/venue cancellations credited/i)
    expect(scroll).toHaveBeenCalled()
    expect(scroll.mock.contexts.at(-1)).toBe(row)
    const other = await rowFor(/July 2026/)
    expect(within(other).getByRole('button', { name: /details/i })).toHaveAttribute('aria-expanded', 'false')
    expect(fetchStatementInvoices).not.toHaveBeenCalledWith(expect.objectContaining({ page: 2 }))
  })

  it('pages through the history until it finds the invoice, shows that page, opens it and scrolls to it', async () => {
    vi.mocked(fetchStatementInvoices).mockImplementation(twoPages)
    renderPage('/admin/reports?invoice=target-id')
    const row = await rowFor(/January 2026/)
    expect(row).toBeDefined()
    await waitFor(() => expect(within(row).getByRole('button', { name: /details/i })).toHaveAttribute('aria-expanded', 'true'))
    expect(row).toHaveTextContent(/venue cancellations credited/i)
    expect(fetchStatementInvoices).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }))
    expect(fetchStatementInvoices).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }))
    await waitFor(() => expect(scroll.mock.contexts.at(-1)).toBe(row))
    // Page 2 is the page on screen: the page-1 fillers (June 2026) are not.
    expect(within(screen.getByRole('region', { name: /invoice history/i })).queryAllByText(/June 2026/)).toHaveLength(0)
  })

  it('an explicit ipage wins over the page the invoice is on', async () => {
    vi.mocked(fetchStatementInvoices).mockImplementation(twoPages)
    renderPage('/admin/reports?invoice=target-id&ipage=1')
    const rows = await historyRows()
    expect(rows).toHaveLength(25)
    expect(rows[0]).toHaveTextContent(/June 2026/)
    expect(within(screen.getByRole('region', { name: /invoice history/i })).queryByText(/January 2026/)).not.toBeInTheDocument()
  })

  it('an unknown invoice id shows nothing extra: no error, page 1, no row open', async () => {
    vi.mocked(fetchStatementInvoices).mockImplementation(twoPages)
    renderPage('/admin/reports?invoice=someone-elses-invoice')
    const rows = await historyRows()
    expect(rows).toHaveLength(25)
    expect(rows[0]).toHaveTextContent(/June 2026/)
    await waitFor(() => expect(fetchStatementInvoices).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })))
    // Never asks for pages beyond the total (30 invoices = 2 pages).
    expect(fetchStatementInvoices).not.toHaveBeenCalledWith(expect.objectContaining({ page: 3 }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    for (const row of await historyRows()) {
      expect(within(row).getByRole('button', { name: /details/i })).toHaveAttribute('aria-expanded', 'false')
    }
    expect(within(screen.getByRole('region', { name: /invoice history/i })).queryByText(/January 2026/)).not.toBeInTheDocument()
    expect(scroll).not.toHaveBeenCalled()
  })

  it('shows the history loader while it is locating the invoice', () => {
    vi.mocked(fetchStatementInvoices).mockReturnValue(new Promise(() => {}))
    renderPage('/admin/reports?invoice=i3')
    expect(screen.getAllByRole('status').some((s) => /loading/i.test(s.textContent ?? ''))).toBe(true)
    expect(screen.queryByRole('region', { name: /invoice history/i })).not.toBeInTheDocument()
  })

  it('shows the error with a retry when the history cannot be loaded while locating', async () => {
    vi.mocked(fetchStatementInvoices).mockRejectedValueOnce(new Error('inv down')).mockResolvedValue(small)
    renderPage('/admin/reports?invoice=i3')
    const alert = await screen.findByRole('alert')
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    const row = await rowFor(/August 2026/)
    await waitFor(() => expect(within(row).getByRole('button', { name: /details/i })).toHaveAttribute('aria-expanded', 'true'))
  })

  it('Download PDF is on sent and paid invoice rows only, never on drafts', async () => {
    renderPage()
    const rows = await historyRows()
    expect(rows).toHaveLength(3)
    expect(within(await rowFor(/October 2026/)).queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument()
    expect(within(await rowFor(/July 2026/)).getByRole('button', { name: 'Download PDF' })).toBeInTheDocument()
    expect(within(await rowFor(/August 2026/)).getByRole('button', { name: 'Download PDF' })).toBeInTheDocument()
  })

  it('Download PDF fetches that invoice\'s PDF and saves it through a download link', async () => {
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' })
    fetchStatementInvoicePdf.mockResolvedValue(blob)
    const downloads: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(`${this.download}|${this.href}`)
    })
    renderPage()
    const row = await rowFor(/August 2026/)
    await userEvent.click(within(row).getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect(fetchStatementInvoicePdf).toHaveBeenCalledWith('i3')
    expect(create).toHaveBeenCalledWith(blob)
    expect(downloads[0]).toMatch(/^[^|]+\.pdf\|blob:invoice-1$/)
    expect(within(row).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('Download PDF is disabled while the PDF is being fetched', async () => {
    let resolve: (b: Blob) => void = () => {}
    fetchStatementInvoicePdf.mockReturnValue(new Promise<Blob>((r) => { resolve = r }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderPage()
    const row = await rowFor(/July 2026/)
    const button = within(row).getByRole('button', { name: 'Download PDF' })
    await userEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    resolve(new Blob(['%PDF-1.7']))
    await waitFor(() => expect(button).toBeEnabled())
  })

  it('a failed download shows the error as an alert in that row and the button works again', async () => {
    fetchStatementInvoicePdf.mockRejectedValueOnce(new Error("We couldn't open the invoice PDF."))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderPage()
    const row = await rowFor(/August 2026/)
    const button = within(row).getByRole('button', { name: 'Download PDF' })
    await userEvent.click(button)
    expect(await within(row).findByRole('alert')).toHaveTextContent("We couldn't open the invoice PDF.")
    expect(button).toBeEnabled()
    expect(click).not.toHaveBeenCalled()
    fetchStatementInvoicePdf.mockResolvedValueOnce(new Blob(['%PDF-1.7']))
    await userEvent.click(button)
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect(fetchStatementInvoicePdf).toHaveBeenCalledTimes(2)
  })
})
