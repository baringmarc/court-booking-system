// T17.19: the routed Invoices page. Migrates InvoicesList.test.tsx and InvoiceDetail.test.tsx (the detail now lives in
// the record panel and reads one page of lines) and adds paging, month/status/search filters and URL state.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import type { InvoiceDetailPageData, InvoiceLine, InvoiceOverview, Page } from './api'

const mocks = vi.hoisted(() => ({
  admin: vi.fn<() => Promise<boolean>>(),
  invoices: vi.fn<(input: { search: string; status: string; month: string; page: number }) => Promise<unknown>>(),
  detail: vi.fn<(input: { invoiceId: string; page: number }) => Promise<unknown>>(),
  sent: vi.fn<(id: string) => Promise<void>>(),
  paid: vi.fn<(input: { invoiceId: string; method: string; reference: string }) => Promise<void>>(),
}))
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  fetchIsPlatformAdmin: mocks.admin, fetchInvoicesPage: mocks.invoices, fetchInvoiceDetailPage: mocks.detail,
  markInvoiceSent: mocks.sent, markInvoicePaid: mocks.paid,
}))

const { ConsoleApp } = await import('./ConsoleApp')

function invoice(over: Partial<InvoiceOverview> = {}): InvoiceOverview {
  return {
    invoice_id: 'i1', venue_id: 'v1', slug: 'e2e-alpha', name: 'E2E Alpha Courts', billing_month: '2026-03-01', status: 'draft',
    sent_at: null, paid_at: null, paid_method: null, paid_reference: null,
    fee_count: 2, fee_total: 25.5, adjustment_total: -5, total: 20.5, due_at: null, overdue: false, ...over,
  }
}
const LINES: InvoiceLine[] = [
  { charge_id: 'c1', booking_id: 'b1', reference_code: 'CB-XXXXAB', kind: 'booking_fee', amount: 15.5, charged_at: '2026-03-05T05:00:00Z' },
  { charge_id: 'c2', booking_id: 'b2', reference_code: 'CB-XXXXCD', kind: 'booking_fee', amount: 10, charged_at: '2026-03-10T05:00:00Z' },
  { charge_id: 'c3', booking_id: 'b3', reference_code: 'CB-XXXXEF', kind: 'adjustment', amount: -5, charged_at: '2026-03-20T05:00:00Z' },
]
function detail(over: Partial<InvoiceDetailPageData> = {}): InvoiceDetailPageData {
  return { ...invoice(), lines: LINES, line_total: LINES.length, ...over }
}

const pad = (n: number) => String(n).padStart(3, '0')
function manyInvoices(count: number): InvoiceOverview[] {
  return Array.from({ length: count }, (_, i) => invoice({
    invoice_id: `i${pad(i + 1)}`, slug: `e2e-inv-${pad(i + 1)}`, name: `E2E Inv ${pad(i + 1)}`,
    status: (i + 1) % 2 === 0 ? 'paid' : 'draft', billing_month: i < 30 ? '2026-03-01' : '2026-02-01',
  }))
}
function servePages(all: InvoiceOverview[]) {
  mocks.invoices.mockImplementation(async ({ status, search, month, page }) => {
    const rows = all.filter((v) => (status === '' || v.status === status) && (month === '' || v.billing_month === month) && v.name.toLowerCase().includes(search.toLowerCase()))
    return { rows: rows.slice((page - 1) * 25, page * 25), total: rows.length } satisfies Page<InvoiceOverview>
  })
}

function Probe() {
  const location = useLocation()
  const navigate = useNavigate()
  return <div><div data-testid="location">{location.pathname + location.search}</div><button type="button" onClick={() => void navigate(-1)}>history back</button></div>
}
function renderAt(path = '/invoices') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}><AuthContext.Provider value={authState('admin')}>
      <MemoryRouter initialEntries={[path]}><ConsoleApp /><Probe /></MemoryRouter>
    </AuthContext.Provider></QueryClientProvider>,
  )
}
const params = () => new URL(screen.getByTestId('location').textContent ?? '', 'http://x').searchParams
const names = () => screen.queryAllByText(/^E2E Inv \d{3}$/).map((e) => e.textContent)
function detailsFor(name: string) { return screen.getByRole('button', { name: new RegExp(`^(?=.*details)(?=.*${name})`, 'i') }) }
async function panelFor(name: string) {
  const re = new RegExp(name, 'i')
  return waitFor(() => {
    const el = screen.queryByRole('dialog', { name: re }) ?? screen.queryByRole('region', { name: re })
    expect(el).not.toBeNull()
    return el as HTMLElement
  })
}

beforeEach(() => {
  mocks.admin.mockReset().mockResolvedValue(true)
  mocks.invoices.mockReset()
  mocks.detail.mockReset().mockResolvedValue(detail())
  mocks.sent.mockReset().mockResolvedValue(undefined)
  mocks.paid.mockReset().mockResolvedValue(undefined)
})
afterEach(() => { vi.restoreAllMocks() })

describe('Invoices page states (was InvoicesList)', () => {
  it('has an Invoices h1', async () => {
    mocks.invoices.mockResolvedValue({ rows: [], total: 0 })
    renderAt()
    expect(await screen.findByRole('heading', { level: 1, name: 'Invoices' })).toBeInTheDocument()
    await screen.findByText(/no invoices/i)
  })

  it('shows a loading state while the invoices load', async () => {
    mocks.invoices.mockReturnValue(new Promise(() => {}))
    renderAt()
    expect(await screen.findByText(/loading invoices/i)).toBeInTheDocument()
  })

  it('shows an empty state when there are no invoices', async () => {
    mocks.invoices.mockResolvedValue({ rows: [], total: 0 })
    renderAt()
    expect(await screen.findByText(/no invoices yet/i)).toBeInTheDocument()
  })

  it('shows a filtered-empty message (not "No invoices yet") when the filters match nothing', async () => {
    servePages(manyInvoices(3))
    renderAt('/invoices?status=sent')
    expect(await screen.findByText(/no invoices/i)).toBeInTheDocument()
    expect(screen.queryByText(/no invoices yet/i)).not.toBeInTheDocument()
  })

  it('shows an error with a Retry button that loads again', async () => {
    mocks.invoices.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ rows: [invoice()], total: 1 })
    renderAt()
    expect(await screen.findByText(/couldn't load invoices/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('E2E Alpha Courts')).toBeInTheDocument()
  })
})

describe('Invoices rows', () => {
  it('lists each invoice with its number, venue name, status and PHP total', async () => {
    mocks.invoices.mockResolvedValue({ rows: [
      invoice(),
      invoice({ invoice_id: 'i2', slug: 'e2e-bravo', name: 'E2E Bravo', billing_month: '2025-12-01', status: 'paid', total: 1234.5 }),
    ], total: 2 })
    renderAt()
    const first = (await screen.findByText('E2E Alpha Courts')).closest('li')!
    expect(within(first).getByText(/E2E-ALPHA-202603/)).toBeInTheDocument()
    expect(within(first).getByText(/draft/i)).toBeInTheDocument()
    expect(within(first).getByText(/₱\s?20\.50/)).toBeInTheDocument()
    const second = screen.getByText('E2E Bravo').closest('li')!
    expect(within(second).getByText(/E2E-BRAVO-202512/)).toBeInTheDocument()
    expect(within(second).getByText(/paid/i)).toBeInTheDocument()
    expect(within(second).getByText(/₱\s?1,234\.50/)).toBeInTheDocument()
  })

  it('flags only overdue invoices with Overdue', async () => {
    mocks.invoices.mockResolvedValue({ rows: [
      invoice({ invoice_id: 'i1', name: 'Late One', status: 'sent', overdue: true }),
      invoice({ invoice_id: 'i2', name: 'On Time', status: 'sent', overdue: false }),
    ], total: 2 })
    renderAt()
    const late = (await screen.findByText('Late One')).closest('li')!
    expect(within(late).getByText('Overdue')).toBeInTheDocument()
    expect(within(screen.getByText('On Time').closest('li')!).queryByText('Overdue')).not.toBeInTheDocument()
  })

  it('opens the detail of an invoice with its Details button, reading page 1 of its lines', async () => {
    mocks.invoices.mockResolvedValue({ rows: [invoice()], total: 1 })
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: /details/i }))
    expect(mocks.detail).toHaveBeenCalledWith({ invoiceId: 'i1', page: 1 })
    expect(params().get('open')).toBe('i1')
    expect(await screen.findByText('Statement of amounts; not a tax invoice.')).toBeInTheDocument()
  })
})

describe('Invoice detail panel (was InvoiceDetail)', () => {
  async function open(over: Partial<InvoiceDetailPageData> = {}, onList: Partial<InvoiceOverview> = {}) {
    mocks.invoices.mockResolvedValue({ rows: [invoice(onList)], total: 1 })
    mocks.detail.mockResolvedValue(detail(over))
    renderAt('/invoices?open=i1')
    const panel = await panelFor('E2E-ALPHA-202603')
    await within(panel).findByText('CB-XXXXAB')
    return panel
  }

  it('shows a loading state, then an error with Retry when the detail fails', async () => {
    mocks.invoices.mockResolvedValue({ rows: [invoice()], total: 1 })
    mocks.detail.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(detail())
    renderAt('/invoices?open=i1')
    expect(await screen.findByText(/loading invoice/i)).toBeInTheDocument()
    expect(await screen.findByText(/couldn't load invoice/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Statement of amounts; not a tax invoice.')).toBeInTheDocument()
  })

  it('shows the fee count and subtotal, the adjustments subtotal and the total in PHP', async () => {
    const panel = await open()
    expect(within(panel).getByText(/2 booking fees?/i)).toBeInTheDocument()
    expect(within(panel).getAllByText(/₱\s?25\.50/).length).toBeGreaterThan(0)
    expect(within(panel).getAllByText(/-\s?₱\s?5\.00|₱\s?-5\.00|−\s?₱\s?5\.00/).length).toBeGreaterThan(0)
    expect(within(panel).getAllByText(/₱\s?20\.50/).length).toBeGreaterThan(0)
  })

  it('lists every line of the page with its booking reference code as a link', async () => {
    const panel = await open()
    for (const code of ['CB-XXXXAB', 'CB-XXXXCD', 'CB-XXXXEF']) expect(within(panel).getByRole('link', { name: code })).toBeInTheDocument()
  })

  it('shows the invoice number and venue name', async () => {
    const panel = await open()
    expect(within(panel).getAllByText(/E2E-ALPHA-202603/).length).toBeGreaterThan(0)
    expect(within(panel).getAllByText(/E2E Alpha Courts/).length).toBeGreaterThan(0)
  })

  it('pages the lines: 25 of 30 on page 1, and Next asks for page 2 only', async () => {
    const page1 = Array.from({ length: 25 }, (_, i): InvoiceLine => ({ charge_id: `c${i}`, booking_id: `b${i}`, reference_code: `CB-P1${pad(i)}`, kind: 'booking_fee', amount: 10, charged_at: '2026-03-05T05:00:00Z' }))
    const page2 = Array.from({ length: 5 }, (_, i): InvoiceLine => ({ charge_id: `d${i}`, booking_id: `e${i}`, reference_code: `CB-P2${pad(i)}`, kind: 'booking_fee', amount: 10, charged_at: '2026-03-06T05:00:00Z' }))
    mocks.invoices.mockResolvedValue({ rows: [invoice({ fee_count: 30, fee_total: 300, total: 300 })], total: 1 })
    mocks.detail.mockImplementation(async ({ page }) => detail({ fee_count: 30, fee_total: 300, total: 300, line_total: 30, lines: page === 1 ? page1 : page2 }))
    renderAt('/invoices?open=i1')
    const panel = await panelFor('E2E-ALPHA-202603')
    await within(panel).findByText('CB-P1000')
    expect(within(panel).getAllByRole('link', { name: /^CB-P1/ })).toHaveLength(25)
    expect(within(panel).getByText(/Showing 1\s*[–-]\s*25 of 30/)).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Previous' })).toBeDisabled()
    await userEvent.click(within(panel).getByRole('button', { name: 'Next' }))
    await within(panel).findByText('CB-P2000')
    expect(within(panel).getAllByRole('link', { name: /^CB-P2/ })).toHaveLength(5)
    expect(within(panel).queryByRole('link', { name: /^CB-P1/ })).not.toBeInTheDocument()
    expect(mocks.detail).toHaveBeenLastCalledWith({ invoiceId: 'i1', page: 2 })
    expect(within(panel).getAllByText(/₱\s?300\.00/).length).toBeGreaterThan(0)
    expect(within(panel).getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('shows Mark as sent on a draft, calls it with the invoice id, reloads the list and offers no paid form', async () => {
    const panel = await open()
    const before = mocks.invoices.mock.calls.length
    await userEvent.click(within(panel).getByRole('button', { name: 'Mark as sent' }))
    expect(mocks.sent).toHaveBeenCalledWith('i1')
    expect(within(panel).queryByRole('button', { name: 'Mark as paid' })).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.invoices.mock.calls.length).toBeGreaterThan(before))
  })

  it('on a sent invoice shows the paid form and no Mark as sent, and submits method and reference', async () => {
    const panel = await open({ status: 'sent', sent_at: '2026-03-31T00:00:00Z' }, { status: 'sent' })
    expect(within(panel).queryByRole('button', { name: 'Mark as sent' })).not.toBeInTheDocument()
    await userEvent.type(within(panel).getByLabelText(/method/i), 'GCash')
    await userEvent.type(within(panel).getByLabelText(/reference/i), 'TX-123')
    await userEvent.click(within(panel).getByRole('button', { name: 'Mark as paid' }))
    expect(mocks.paid).toHaveBeenCalledWith({ invoiceId: 'i1', method: 'GCash', reference: 'TX-123' })
  })

  it('shows neither action on a paid invoice', async () => {
    const panel = await open({ status: 'paid', paid_method: 'GCash' }, { status: 'paid' })
    expect(within(panel).queryByRole('button', { name: 'Mark as sent' })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Mark as paid' })).not.toBeInTheDocument()
  })

  it('shows an alert when marking as sent fails', async () => {
    mocks.sent.mockRejectedValue(new Error('invalid_status'))
    const panel = await open()
    await userEvent.click(within(panel).getByRole('button', { name: 'Mark as sent' }))
    expect(await within(panel).findByRole('alert')).toBeInTheDocument()
  })

  it('shows an alert when marking as paid fails', async () => {
    mocks.paid.mockRejectedValue(new Error('method_required'))
    const panel = await open({ status: 'sent', sent_at: '2026-03-31T00:00:00Z' }, { status: 'sent' })
    await userEvent.click(within(panel).getByRole('button', { name: 'Mark as paid' }))
    expect(await within(panel).findByRole('alert')).toBeInTheDocument()
  })

  it('Print calls window.print', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const panel = await open()
    await userEvent.click(within(panel).getByRole('button', { name: 'Print' }))
    expect(print).toHaveBeenCalledTimes(1)
  })

  it('Close closes the panel and drops ?open=', async () => {
    const panel = await open()
    await userEvent.click(within(panel).getByRole('button', { name: /close/i }))
    expect(screen.queryByText('CB-XXXXAB')).not.toBeInTheDocument()
    expect(params().has('open')).toBe(false)
  })
})

describe('Invoices filtering, paging and URL state', () => {
  it('fetches the first bounded page with the default filters', async () => {
    servePages(manyInvoices(60))
    renderAt()
    await screen.findByText('E2E Inv 001')
    expect(mocks.invoices).toHaveBeenCalledWith({ search: '', status: '', month: '', page: 1 })
    expect(names()).toHaveLength(25)
  })

  it('offers All, Draft, Sent and Paid under "Filter by status"', async () => {
    servePages(manyInvoices(60))
    renderAt()
    const filter = await screen.findByLabelText('Filter by status')
    expect(within(filter).getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'Draft', 'Sent', 'Paid'])
    await userEvent.selectOptions(filter, 'paid')
    await waitFor(() => expect(mocks.invoices).toHaveBeenLastCalledWith({ search: '', status: 'paid', month: '', page: 1 }))
    expect(params().get('status')).toBe('paid')
  })

  it('pages through 60 invoices with no dropped or duplicated row', async () => {
    servePages(manyInvoices(60))
    renderAt()
    await screen.findByText('E2E Inv 001')
    const seen: (string | null)[] = [...names()]
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('E2E Inv 026')
    seen.push(...names())
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('E2E Inv 051')
    seen.push(...names())
    expect(screen.getByText(/Showing 51\s*[–-]\s*60 of 60/)).toBeInTheDocument()
    expect(seen).toEqual(manyInvoices(60).map((v) => v.name))
    for (const [input] of mocks.invoices.mock.calls) expect(Object.keys(input).sort()).toEqual(['month', 'page', 'search', 'status'])
  })

  it('a billing month filter sends the first day of that month and resets the page', async () => {
    servePages(manyInvoices(60))
    renderAt('/invoices?page=3')
    await screen.findByText('E2E Inv 051')
    fireEvent.change(screen.getByLabelText('Billing month'), { target: { value: '2026-02' } })
    await waitFor(() => expect(mocks.invoices).toHaveBeenLastCalledWith({ search: '', status: '', month: '2026-02-01', page: 1 }))
    expect(params().get('month')).toBe('2026-02-01')
    expect(params().get('page') ?? '1').toBe('1')
    await waitFor(() => expect(names()[0]).toBe('E2E Inv 031'))
  })

  it('searching resets the page and writes ?q=', async () => {
    servePages(manyInvoices(60))
    renderAt('/invoices?page=2')
    await screen.findByText('E2E Inv 026')
    await userEvent.type(screen.getByLabelText(/search/i), 'Inv 00')
    await waitFor(() => expect(mocks.invoices).toHaveBeenLastCalledWith({ search: 'Inv 00', status: '', month: '', page: 1 }), { timeout: 3000 })
    expect(params().get('q')).toBe('Inv 00')
  })

  it('restores status, month, search and page from the URL on a fresh load', async () => {
    servePages(manyInvoices(60))
    renderAt('/invoices?status=draft&month=2026-03-01&q=Inv&page=1')
    await waitFor(() => expect(mocks.invoices).toHaveBeenCalledWith({ search: 'Inv', status: 'draft', month: '2026-03-01', page: 1 }))
    expect(screen.getByLabelText('Filter by status')).toHaveValue('draft')
    expect(screen.getByLabelText('Billing month')).toHaveValue('2026-03')
    expect(screen.getByLabelText(/search/i)).toHaveValue('Inv')
  })

  it('back navigation restores the previous page', async () => {
    servePages(manyInvoices(60))
    renderAt()
    await screen.findByText('E2E Inv 001')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('E2E Inv 026')
    await userEvent.click(screen.getByRole('button', { name: 'history back' }))
    expect(await screen.findByText('E2E Inv 001')).toBeInTheDocument()
    expect(screen.queryByText('E2E Inv 026')).not.toBeInTheDocument()
  })

  it('opening Details on page 2 keeps the page in the URL', async () => {
    servePages(manyInvoices(60))
    renderAt('/invoices?page=2')
    await screen.findByText('E2E Inv 026')
    await userEvent.click(detailsFor('E2E Inv 026'))
    expect(params().get('page')).toBe('2')
    expect(params().get('open')).toBe('i026')
  })
})
