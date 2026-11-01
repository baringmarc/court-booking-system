// T14.11: the venue admin's statement page.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'
import { fetchStatement, type VenueStatement } from './api'
import { StatementPage } from './StatementPage'

vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchStatement: vi.fn() }))
vi.mock('../catalog/hooks', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useVenueSettings: () => ({ data: { timezone: 'Asia/Manila', currency: 'PHP' }, isPending: false, isError: false, error: null, refetch: vi.fn() }),
}))

const statement: VenueStatement = {
  month: '2026-10-01',
  fee_count: 4,
  fee_total: 40,
  adjustment_total: -10,
  total: 30,
  by_method: [
    { method: 'account', paid_with: 'BPI Savings', count: 2, fee_total: 20 },
    { method: 'cash', paid_with: null, count: 1, fee_total: 10 },
    { method: null, paid_with: null, count: 1, fee_total: 10 },
  ],
  lines: [
    { charge_id: 'c1', booking_id: 'b1', reference_code: 'CB-XXXXSA', kind: 'booking_fee', amount: 10, charged_at: '2026-10-02T01:00:00+00:00' },
    { charge_id: 'c2', booking_id: 'b2', reference_code: 'CB-XXXXSB', kind: 'booking_fee', amount: 10, charged_at: '2026-10-03T01:00:00+00:00' },
    { charge_id: 'c3', booking_id: 'b3', reference_code: 'CB-XXXXSE', kind: 'adjustment', amount: -10, charged_at: '2026-10-05T01:00:00+00:00' },
  ],
  invoices: [
    { invoice_id: 'i1', billing_month: '2026-10-01', status: 'draft', total: 30, sent_at: null, paid_at: null },
    { invoice_id: 'i2', billing_month: '2026-09-01', status: 'paid', total: 777.5, sent_at: '2026-10-01T00:00:00+00:00', paid_at: '2026-10-05T00:00:00+00:00' },
    { invoice_id: 'i3', billing_month: '2026-08-01', status: 'sent', total: 555, sent_at: '2026-09-01T00:00:00+00:00', paid_at: null },
  ],
}

const empty: VenueStatement = { month: '2026-10-01', fee_count: 0, fee_total: 0, adjustment_total: 0, total: 0, by_method: [], lines: [], invoices: [] }

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter><StatementPage /></MemoryRouter></QueryClientProvider>)
}

/** The nearest list row / container of a text, for reading the amount beside a label. */
const rowOf = (el: HTMLElement) => (el.closest('li, tr, dl > div') ?? el.parentElement) as HTMLElement

describe('StatementPage', () => {
  beforeEach(() => {
    setCurrentVenue({ id: 'venue-a', slug: 'a-venue', status: 'active' })
    vi.mocked(fetchStatement).mockReset().mockResolvedValue(statement)
  })

  it('shows a loader while the statement loads', () => {
    vi.mocked(fetchStatement).mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByRole('heading', { name: 'Statement' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
  })

  it('shows this month\'s fees, venue cancellations credited and the running total in the venue currency', async () => {
    renderPage()
    expect(await screen.findByText(/October 2026/)).toBeInTheDocument()
    expect(rowOf(screen.getByText(/venue cancellations credited/i))).toHaveTextContent(/10(\.00)?/)
    expect(rowOf(screen.getByText(/venue cancellations credited/i))).toHaveTextContent('₱')
    expect(screen.getAllByText(/₱40(\.00)?$/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/₱30(\.00)?$/).length).toBeGreaterThan(0)
  })

  it('lists "By payment method" with an account payment under its paid_with label and the counts', async () => {
    renderPage()
    const heading = await screen.findByRole('heading', { name: 'By payment method' })
    const section = heading.parentElement as HTMLElement
    const rows = within(section).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(within(section).getByText(/BPI Savings/)).toBeInTheDocument()
    expect(within(section).getByText(/Cash/)).toBeInTheDocument()
    expect(rowOf(within(section).getByText(/BPI Savings/))).toHaveTextContent('2')
    expect(rowOf(within(section).getByText(/BPI Savings/))).toHaveTextContent(/₱20(\.00)?/)
  })

  it('lists each charge line with its booking reference as a link to the admin bookings', async () => {
    renderPage()
    for (const code of ['CB-XXXXSA', 'CB-XXXXSB', 'CB-XXXXSE']) {
      const link = await screen.findByRole('link', { name: code })
      expect(link.getAttribute('href')).toMatch(/^\/admin\/bookings/)
    }
    expect(rowOf(screen.getByRole('link', { name: 'CB-XXXXSE' }))).toHaveTextContent(/10(\.00)?/)
  })

  it('lists "Past invoices" with month, status and total', async () => {
    renderPage()
    const heading = await screen.findByRole('heading', { name: 'Past invoices' })
    const section = heading.parentElement as HTMLElement
    const rows = within(section).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toHaveTextContent(/September 2026/)
    expect(rows[1]).toHaveTextContent(/paid/i)
    expect(rows[1]).toHaveTextContent(/₱777\.50/)
    expect(rows[2]).toHaveTextContent(/August 2026/)
    expect(rows[2]).toHaveTextContent(/sent/i)
    expect(rows[2]).toHaveTextContent(/₱555/)
    expect(rows[0]).toHaveTextContent(/draft/i)
  })

  it('says so when there are no charges and no invoices yet', async () => {
    vi.mocked(fetchStatement).mockResolvedValue(empty)
    renderPage()
    expect(await screen.findByText(/no charges yet/i)).toBeInTheDocument()
    expect(screen.getByText(/no invoices yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^CB-/ })).not.toBeInTheDocument()
  })

  it('shows the error with a retry that fetches again', async () => {
    vi.mocked(fetchStatement).mockRejectedValueOnce(new Error('boom'))
    renderPage()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'CB-XXXXSA' })).toBeInTheDocument()
    expect(fetchStatement).toHaveBeenCalledTimes(2)
  })
})
