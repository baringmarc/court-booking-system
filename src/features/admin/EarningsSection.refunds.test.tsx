// T30.6: Refunded per method and Net next to Collected, and the "Refunds owed" warning that replaces the old
// "received online but not accepted" note.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Json } from '../../lib/database.types'
import { fetchBookingsForExport, fetchEarnings, fetchPaymentsForExport } from './api'
import { fetchPlatformFee } from '../booking/api'
import { EarningsSection } from './EarningsSection'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchEarnings: vi.fn(),
  fetchBookingsForExport: vi.fn(),
  fetchPaymentsForExport: vi.fn(),
}))
vi.mock('../booking/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchPlatformFee: vi.fn() }))

// Sunday 2026-10-25.
const TODAY = '2026-10-25'

const result = (patch: Record<string, Json> = {}): Json => ({
  from: TODAY, to: TODAY, timezone: 'Asia/Manila',
  collected: { total: 1500, count: 3, by_method: [{ method: 'cash', amount: 1500, count: 3 }] },
  previous: { from: '2026-10-24', to: '2026-10-24', total: 1000, count: 2, by_method: [] },
  refunds_due: { count: 0, total: 0 },
  refunded: {
    total: 200, count: 2,
    by_method: [{ method: 'gcash', amount: 150, count: 1 }, { method: 'cash', amount: 50, count: 1 }],
    previous: { from: '2026-10-24', to: '2026-10-24', total: 100, count: 1, by_method: [] },
  },
  net: { total: 1300, previous: { total: 900 } },
  daily: [{ date: TODAY, collected: 1500, sold_hours: 5 }],
  courts: [{ court_id: 'A', name: 'Badminton 1', sport: 'badminton', open_hours: 16, blackout_hours: 0, sold_hours: 4, open_play_hours: 2 }],
  sports: [{ sport: 'badminton', open_hours: 16, blackout_hours: 0, sold_hours: 4, open_play_hours: 2 }],
  coming_up: { count: 2, value: 1300 },
  split: {
    total_revenue: 1500, plotline_fees: 20, owner_earnings: 1480,
    previous: { total_revenue: 1000, plotline_fees: 10, owner_earnings: 990 },
  },
  ...patch,
})

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><EarningsSection today={TODAY} timeZone="Asia/Manila" currency="PHP" /></MemoryRouter>
    </QueryClientProvider>,
  )
}
const section = async (name: string) => {
  const heading = await screen.findByRole('heading', { name, level: 3 })
  return heading.closest('section')!
}

beforeEach(() => {
  vi.mocked(fetchEarnings).mockReset().mockResolvedValue(result())
  vi.mocked(fetchPlatformFee).mockReset().mockResolvedValue(10)
  vi.mocked(fetchBookingsForExport).mockReset().mockResolvedValue([])
  vi.mocked(fetchPaymentsForExport).mockReset().mockResolvedValue([])
})

describe('EarningsSection Refunded and Net (T30.6)', () => {
  it('shows Collected, Refunded, Net and Coming up as cards in that order', async () => {
    renderSection()
    const refunded = await section('Refunded')
    const cards = refunded.parentElement!
    expect(cards).toHaveClass('dash-cards')
    expect(within(cards).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Collected', 'Refunded', 'Net', 'Coming up'])
  })

  it('shows what was refunded, its change against yesterday and the methods it went out by', async () => {
    renderSection()
    const card = within(await section('Refunded'))
    expect(card.getByText('₱200')).toHaveClass('big-number')
    expect(card.getByText('₱100 more than yesterday (+100%).')).toBeInTheDocument()
    const methods = within(card.getByRole('list', { name: 'Refunded by method' })).getAllByRole('listitem')
    expect(methods.map((li) => li.textContent)).toEqual(['GCash (1)₱150', 'Cash (1)₱50'])
  })

  it('says when nothing was refunded', async () => {
    vi.mocked(fetchEarnings).mockResolvedValue(result({
      refunded: { total: 0, count: 0, by_method: [], previous: { from: '2026-10-24', to: '2026-10-24', total: 0, count: 0, by_method: [] } },
      net: { total: 1500, previous: { total: 1000 } },
    }))
    renderSection()
    const card = within(await section('Refunded'))
    expect(card.getByText('₱0')).toHaveClass('big-number')
    expect(card.getByText('Nothing refunded in this period.')).toBeInTheDocument()
    expect(card.getByText('The same as yesterday.')).toBeInTheDocument()
    expect(card.queryByRole('list', { name: 'Refunded by method' })).not.toBeInTheDocument()
  })

  it('shows centavos in the refunded total', async () => {
    vi.mocked(fetchEarnings).mockResolvedValue(result({
      refunded: { total: 150.5, count: 1, by_method: [{ method: 'maya', amount: 150.5, count: 1 }], previous: { from: '', to: '', total: 0, count: 0, by_method: [] } },
    }))
    renderSection()
    const card = within(await section('Refunded'))
    expect(card.getByText('₱150.50', { selector: '.big-number' })).toBeInTheDocument()
    const methods = within(card.getByRole('list', { name: 'Refunded by method' })).getAllByRole('listitem')
    expect(methods.map((li) => li.textContent)).toEqual(['Maya (1)₱150.50'])
  })

  it('shows the net figure, its change against yesterday and what it means', async () => {
    renderSection()
    const card = within(await section('Net'))
    expect(card.getByText('₱1,300')).toHaveClass('big-number')
    expect(card.getByText('₱400 more than yesterday (+44%).')).toBeInTheDocument()
    expect(card.getByText('Collected minus refunded.')).toBeInTheDocument()
  })

  it('says less when the net went down', async () => {
    vi.mocked(fetchEarnings).mockResolvedValue(result({ net: { total: 800, previous: { total: 1000 } } }))
    renderSection()
    expect(within(await section('Net')).getByText('₱200 less than yesterday (-20%).')).toBeInTheDocument()
  })

  it('compares with last week on the week view', async () => {
    const user = userEvent.setup()
    renderSection()
    await section('Net')
    vi.mocked(fetchEarnings).mockResolvedValue(result({
      from: '2026-10-19', to: TODAY,
      previous: { from: '2026-10-12', to: '2026-10-18', total: 1000, count: 2, by_method: [] },
      refunded: { total: 300, count: 2, by_method: [{ method: 'gcash', amount: 300, count: 2 }], previous: { from: '2026-10-12', to: '2026-10-18', total: 300, count: 1, by_method: [] } },
      net: { total: 1200, previous: { total: 700 } },
    }))
    await user.click(screen.getByRole('button', { name: 'This week' }))
    expect(await screen.findByText('₱500 more than last week (+71%).')).toBeInTheDocument()
    expect(within(await section('Net')).getByText('₱500 more than last week (+71%).')).toBeInTheDocument()
    expect(within(await section('Refunded')).getByText('The same as last week.')).toBeInTheDocument()
  })

  it('reads missing refunded and net as zero', async () => {
    vi.mocked(fetchEarnings).mockResolvedValue(result({ refunded: null, net: null }))
    renderSection()
    const refunded = within(await section('Refunded'))
    expect(refunded.getByText('₱0')).toHaveClass('big-number')
    expect(refunded.getByText('Nothing refunded in this period.')).toBeInTheDocument()
    expect(within(await section('Net')).getByText('₱0')).toHaveClass('big-number')
  })
})

describe('EarningsSection refunds owed warning (T30.6)', () => {
  it('shows what is owed in the Collected card with a link to settle it, and not the old note', async () => {
    vi.mocked(fetchEarnings).mockResolvedValue(result({ refunds_due: { count: 2, total: 700 } }))
    renderSection()
    const collected = within(await section('Collected'))
    const warning = collected.getByRole('status')
    expect(warning).toHaveClass('form-warning')
    expect(warning).toHaveTextContent('Refunds owed: ₱700 (2 refunds). Settle them')
    expect(within(warning).getByRole('link', { name: 'Settle them' })).toHaveAttribute('href', '/admin/bookings?status=all&refund=owed')
    expect(screen.queryByText(/received online but not accepted/)).not.toBeInTheDocument()
    expect(screen.queryByText(/refund outside the app/)).not.toBeInTheDocument()
    // Only in the Collected card.
    expect(within(await section('Refunded')).queryByText(/Refunds owed/)).not.toBeInTheDocument()
    expect(within(await section('Net')).queryByText(/Refunds owed/)).not.toBeInTheDocument()
  })

  it('says "1 refund" for one', async () => {
    vi.mocked(fetchEarnings).mockResolvedValue(result({ refunds_due: { count: 1, total: 300 } }))
    renderSection()
    expect(within(await section('Collected')).getByRole('status')).toHaveTextContent('Refunds owed: ₱300 (1 refund). Settle them')
  })

  it('shows nothing when no refund is owed', async () => {
    renderSection()
    const collected = within(await section('Collected'))
    expect(collected.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText(/Refunds owed/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Settle them' })).not.toBeInTheDocument()
  })
})
