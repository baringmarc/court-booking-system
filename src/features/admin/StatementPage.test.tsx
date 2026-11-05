// T17.22: the statement page reads the paged statement (summary, charges, invoice history) and keeps its view state in the URL.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'
import {
  fetchStatementCharges, fetchStatementInvoices, fetchStatementSummary,
  type StatementCharge, type StatementInvoice, type StatementPage as Paged, type StatementSummary,
} from './api'
import { StatementPage } from './StatementPage'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchStatementSummary: vi.fn(),
  fetchStatementCharges: vi.fn(),
  fetchStatementInvoices: vi.fn(),
}))
vi.mock('../catalog/hooks', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useVenueSettings: () => ({ data: { timezone: 'Asia/Manila', currency: 'PHP' }, isPending: false, isError: false, error: null, refetch: vi.fn() }),
}))

const summary: StatementSummary = {
  month: '2026-10-01',
  fee_count: 40,
  fee_total: 400,
  adjustment_total: -30,
  total: 370,
  by_method: [
    { method: 'account', paid_with: 'BPI Savings', count: 25, fee_total: 250 },
    { method: 'cash', paid_with: null, count: 15, fee_total: 150 },
  ],
  accrual: { fee_count: 12, fee_total: 120, adjustment_total: -20, total: 100 },
  amount_due: {
    total: 1300,
    count: 2,
    invoices: [
      { invoice_id: 'i3', billing_month: '2026-08-01', total: 800, sent_at: '2026-09-01T00:00:00+00:00', due_at: '2026-09-08T00:00:00+00:00', overdue: true },
      { invoice_id: 'i4', billing_month: '2026-09-01', total: 500, sent_at: '2026-10-01T00:00:00+00:00', due_at: '2026-10-08T00:00:00+00:00', overdue: false },
    ],
  },
}

const charge = (n: number, over: Partial<StatementCharge> = {}): StatementCharge => ({
  charge_id: `c${n}`, booking_id: `b${n}`, reference_code: `CB-REF${String(n).padStart(3, '0')}`, kind: 'booking_fee', amount: 10,
  charged_at: '2026-10-02T01:00:00+00:00', invoice_id: null, ...over,
})
const chargesPage = (from: number, count: number, total: number): Paged<StatementCharge> => ({
  total, rows: Array.from({ length: count }, (_, i) => charge(from + i)),
})

const invoice = (id: string, over: Partial<StatementInvoice>): StatementInvoice => ({
  invoice_id: id, billing_month: '2026-09-01', status: 'draft', fee_total: 0, adjustment_total: 0, total: 0, sent_at: null, due_at: null,
  overdue: false, paid_at: null, paid_method: null, paid_reference: null, ...over,
})
const invoices: Paged<StatementInvoice> = {
  total: 3,
  rows: [
    invoice('i1', { billing_month: '2026-10-01', status: 'draft', fee_total: 90, adjustment_total: -10, total: 80 }),
    invoice('i2', { billing_month: '2026-07-01', status: 'paid', fee_total: 800, adjustment_total: -22.5, total: 777.5, sent_at: '2026-08-01T00:00:00+00:00', due_at: '2026-08-08T00:00:00+00:00', paid_at: '2026-08-05T00:00:00+00:00', paid_method: 'GCash', paid_reference: 'R-1' }),
    invoice('i3', { billing_month: '2026-08-01', status: 'sent', fee_total: 900, adjustment_total: -100, total: 800, sent_at: '2026-09-01T00:00:00+00:00', due_at: '2026-09-08T00:00:00+00:00', overdue: true }),
  ],
}

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{loc.pathname + loc.search}</output>
}
function renderPage(url = '/admin/reports') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}><StatementPage /><Where /></MemoryRouter></QueryClientProvider>)
}
const where = () => screen.getByTestId('where').textContent ?? ''
const params = () => new URL(where(), 'http://x').searchParams

describe('StatementPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T04:00:00Z') })
    setCurrentVenue({ id: 'venue-a', slug: 'a-venue', status: 'active' })
    vi.mocked(fetchStatementSummary).mockReset().mockResolvedValue(summary)
    vi.mocked(fetchStatementCharges).mockReset().mockResolvedValue(chargesPage(1, 25, 40))
    vi.mocked(fetchStatementInvoices).mockReset().mockResolvedValue(invoices)
  })
  afterEach(() => { vi.useRealTimers() })

  it('shows loaders while each section loads', () => {
    vi.mocked(fetchStatementSummary).mockReturnValue(new Promise(() => {}))
    vi.mocked(fetchStatementCharges).mockReturnValue(new Promise(() => {}))
    vi.mocked(fetchStatementInvoices).mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Statement' })).toBeInTheDocument()
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Loading')
  })

  it('shows the amount due from sent invoices only, with each due date and an Overdue marker', async () => {
    renderPage()
    const due = await screen.findByRole('region', { name: /amount due/i })
    expect(due).toHaveTextContent(/₱1,300(\.00)?/)
    expect(due).toHaveTextContent(/sent invoices/i)
    const rows = within(due).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent(/August 2026/)
    expect(rows[0]).toHaveTextContent(/₱800(\.00)?/)
    expect(rows[0]).toHaveTextContent(/Sep(tember)? 8/)
    expect(rows[0]).toHaveTextContent(/overdue/i)
    expect(rows[1]).toHaveTextContent(/₱500(\.00)?/)
    expect(rows[1]).not.toHaveTextContent(/overdue/i)
  })

  it('says nothing is due when there are no sent invoices', async () => {
    vi.mocked(fetchStatementSummary).mockResolvedValue({ ...summary, amount_due: { total: 0, count: 0, invoices: [] } })
    renderPage()
    const due = await screen.findByRole('region', { name: /amount due/i })
    expect(due).toHaveTextContent(/nothing (is )?due|no amount due|no invoices? due/i)
    expect(within(due).queryAllByRole('listitem')).toHaveLength(0)
  })

  it('shows "This month\'s fees so far" separately from the amount due and never as due now', async () => {
    renderPage()
    const accrual = await screen.findByRole('region', { name: /this month.s fees so far/i })
    expect(accrual).toHaveTextContent(/₱100(\.00)?/)
    expect(accrual).toHaveTextContent(/not (yet )?(invoiced|due)/i)
    const due = screen.getByRole('region', { name: /amount due/i })
    expect(due).not.toContainElement(accrual)
    expect(accrual).not.toContainElement(due)
    expect(due).not.toHaveTextContent(/fees so far/i)
  })

  it('shows the selected month totals from the summary: fees, venue cancellations credited and total', async () => {
    renderPage()
    const totals = await screen.findByRole('region', { name: /October 2026/ })
    expect(totals).toHaveTextContent(/₱400(\.00)?/)
    expect(totals).toHaveTextContent(/venue cancellations credited/i)
    expect(totals).toHaveTextContent(/₱30(\.00)?/)
    expect(totals).toHaveTextContent(/₱370(\.00)?/)
  })

  it('keeps totals from the whole month even when the charge page has fewer rows', async () => {
    vi.mocked(fetchStatementCharges).mockResolvedValue(chargesPage(26, 3, 3))
    renderPage('/admin/reports?page=2')
    const totals = await screen.findByRole('region', { name: /October 2026/ })
    expect(totals).toHaveTextContent(/₱370(\.00)?/)
    expect(totals).toHaveTextContent(/40/)
  })

  it('lists "By payment method" with the paid_with label and counts', async () => {
    renderPage()
    const heading = await screen.findByRole('heading', { name: 'By payment method' })
    const list = within(heading.parentElement as HTMLElement).getAllByRole('listitem')
    expect(list).toHaveLength(2)
    expect(list[0]).toHaveTextContent('BPI Savings')
    expect(list[0]).toHaveTextContent('25')
    expect(list[0]).toHaveTextContent(/₱250(\.00)?/)
    expect(list[1]).toHaveTextContent(/Cash/)
  })

  it('pages the charges: "Showing 1–25 of 40" from the server total, Next requests page 2 and puts it in the URL', async () => {
    renderPage()
    const nav = await screen.findByRole('navigation', { name: 'Charges pages' })
    expect(await screen.findByRole('link', { name: 'CB-REF001' })).toBeInTheDocument()
    expect(screen.getByText(/Showing 1[–-]25 of 40/)).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: /previous/i })).toBeDisabled()
    vi.mocked(fetchStatementCharges).mockResolvedValue(chargesPage(26, 15, 40))
    await userEvent.click(within(nav).getByRole('button', { name: /next/i }))
    await waitFor(() => expect(fetchStatementCharges).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })))
    expect(await screen.findByRole('link', { name: 'CB-REF026' })).toBeInTheDocument()
    expect(screen.getByText(/Showing 26[–-]40 of 40/)).toBeInTheDocument()
    expect(params().get('page')).toBe('2')
    expect(within(screen.getByRole('navigation', { name: 'Charges pages' })).getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('reads page, month and search from the URL', async () => {
    renderPage('/admin/reports?month=2026-09-01&q=REF0&page=2')
    await waitFor(() => expect(fetchStatementCharges).toHaveBeenCalledWith(expect.objectContaining({ month: '2026-09-01', search: 'REF0', page: 2 })))
    expect(fetchStatementSummary).toHaveBeenCalledWith('2026-09-01')
    expect(screen.getByLabelText('Search booking reference')).toHaveValue('REF0')
  })

  it('changing the month refetches the summary and charges with that month and resets the page', async () => {
    renderPage('/admin/reports?page=2')
    const select = await screen.findByLabelText('Month')
    await userEvent.selectOptions(select, 'September 2026')
    await waitFor(() => expect(fetchStatementSummary).toHaveBeenLastCalledWith('2026-09-01'))
    await waitFor(() => expect(fetchStatementCharges).toHaveBeenLastCalledWith(expect.objectContaining({ month: '2026-09-01', page: 1 })))
    expect(params().get('month')).toBe('2026-09-01')
    expect(params().get('page')).toBeNull()
  })

  it('searching by booking reference refetches charges, resets the page and keeps page 1 out of the URL', async () => {
    renderPage('/admin/reports?page=2')
    const box = await screen.findByLabelText('Search booking reference')
    await userEvent.type(box, 'REF012')
    await waitFor(() => expect(fetchStatementCharges).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'REF012', page: 1 })))
    expect(params().get('q')).toBe('REF012')
    expect(params().get('page')).toBeNull()
  })

  it('each charge reference links to the booking on the admin bookings page', async () => {
    vi.mocked(fetchStatementCharges).mockResolvedValue({ total: 1, rows: [charge(7, { booking_id: 'booking-uuid-7' })] })
    renderPage()
    const link = await screen.findByRole('link', { name: 'CB-REF007' })
    const url = new URL(link.getAttribute('href') ?? '', 'http://localhost')
    expect(url.pathname).toBe('/admin/bookings')
    expect(url.searchParams.get('q')).toBe('CB-REF007')
    expect(url.searchParams.get('booking')).toBe('booking-uuid-7')
  })

  it('shows credits as negative adjustments on the charge list', async () => {
    vi.mocked(fetchStatementCharges).mockResolvedValue({ total: 1, rows: [charge(9, { kind: 'adjustment', amount: -10 })] })
    renderPage()
    const row = (await screen.findByRole('link', { name: 'CB-REF009' })).closest('li, tr') as HTMLElement
    expect(row).toHaveTextContent(/-₱10(\.00)?|₱-10|−₱10/)
  })

  it('says so when the month has no charges, while the other sections still show', async () => {
    vi.mocked(fetchStatementCharges).mockResolvedValue({ total: 0, rows: [] })
    vi.mocked(fetchStatementSummary).mockResolvedValue({ ...summary, fee_count: 0, fee_total: 0, adjustment_total: 0, total: 0, by_method: [] })
    renderPage()
    expect(await screen.findByText(/no charges/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^CB-/ })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: /amount due/i })).toHaveTextContent(/₱1,300/)
  })

  it('lists the invoice history with every status, billing month, due date for sent, overdue and paid details', async () => {
    renderPage()
    const history = await screen.findByRole('region', { name: /invoice history/i })
    const rows = within(history).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent(/October 2026/)
    expect(rows[0]).toHaveTextContent(/draft/i)
    expect(rows[0]).not.toHaveTextContent(/overdue/i)
    expect(rows[1]).toHaveTextContent(/July 2026/)
    expect(rows[1]).toHaveTextContent(/paid/i)
    expect(rows[1]).toHaveTextContent(/₱777\.50/)
    expect(rows[1]).toHaveTextContent(/Aug(ust)? 5/)
    expect(rows[1]).toHaveTextContent(/GCash/)
    expect(rows[2]).toHaveTextContent(/August 2026/)
    expect(rows[2]).toHaveTextContent(/sent/i)
    expect(rows[2]).toHaveTextContent(/Sep(tember)? 8/)
    expect(rows[2]).toHaveTextContent(/overdue/i)
  })

  it('expands an invoice\'s details: fee total, venue cancellations credited and total', async () => {
    renderPage()
    const history = await screen.findByRole('region', { name: /invoice history/i })
    const row = within(history).getAllByRole('listitem')[2]
    const button = within(row).getByRole('button', { name: /details/i })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(row).not.toHaveTextContent(/venue cancellations credited/i)
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(row).toHaveTextContent(/venue cancellations credited/i)
    expect(row).toHaveTextContent(/₱900(\.00)?/)
    expect(row).toHaveTextContent(/₱100(\.00)?/)
    expect(row).toHaveTextContent(/₱800(\.00)?/)
  })

  it('pages the invoice history on its own with ipage in the URL', async () => {
    vi.mocked(fetchStatementInvoices).mockResolvedValue({ ...invoices, total: 30 })
    renderPage()
    const nav = await screen.findByRole('navigation', { name: 'Invoice pages' })
    vi.mocked(fetchStatementInvoices).mockClear()
    await userEvent.click(within(nav).getByRole('button', { name: /next/i }))
    await waitFor(() => expect(fetchStatementInvoices).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })))
    expect(params().get('ipage')).toBe('2')
    expect(params().get('page')).toBeNull()
  })

  it('says so when there are no invoices', async () => {
    vi.mocked(fetchStatementInvoices).mockResolvedValue({ total: 0, rows: [] })
    renderPage()
    expect(await screen.findByText(/no invoices yet/i)).toBeInTheDocument()
  })

  it('shows an error with retry for the summary, and retry fetches again', async () => {
    vi.mocked(fetchStatementSummary).mockRejectedValueOnce(new Error('boom'))
    renderPage()
    const alert = await screen.findByRole('alert')
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: /amount due/i })).toHaveTextContent(/₱1,300/)
    expect(fetchStatementSummary).toHaveBeenCalledTimes(2)
  })

  it('an error in the charges does not hide the invoice history', async () => {
    vi.mocked(fetchStatementCharges).mockRejectedValue(new Error('charges down'))
    renderPage()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: /invoice history/i })).toHaveTextContent(/October 2026/)
  })

  it('an error in the invoice history shows a retry and keeps the charges', async () => {
    vi.mocked(fetchStatementInvoices).mockRejectedValueOnce(new Error('inv down'))
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(await screen.findByRole('link', { name: 'CB-REF001' })).toBeInTheDocument()
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: /invoice history/i })).toHaveTextContent(/July 2026/)
  })
})
