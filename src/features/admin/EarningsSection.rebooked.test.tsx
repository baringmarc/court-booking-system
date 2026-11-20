// T30.4: the earnings section shows how many bookings came back through "Same time next week" in the period.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

beforeAll(async () => {
  await import('../../components/Calendar')
})

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><EarningsSection today={TODAY} timeZone="Asia/Manila" currency="PHP" /></QueryClientProvider>)
}

beforeEach(() => {
  vi.mocked(fetchEarnings).mockReset().mockResolvedValue(result({ rebooked: { count: 3 } }))
  vi.mocked(fetchPlatformFee).mockReset().mockResolvedValue(10)
  vi.mocked(fetchBookingsForExport).mockReset()
  vi.mocked(fetchPaymentsForExport).mockReset()
})

describe('EarningsSection: Booked again with Same time next week (T30.4)', () => {
  it('shows the count for the period', async () => {
    renderSection()
    expect(await screen.findByText('Booked again with Same time next week: 3')).toBeInTheDocument()
  })

  it('shows the line for 0 too', async () => {
    vi.mocked(fetchEarnings).mockResolvedValue(result({ rebooked: { count: 0 } }))
    renderSection()
    expect(await screen.findByText('Booked again with Same time next week: 0')).toBeInTheDocument()
  })

  it('reads a result without rebooked as 0', async () => {
    vi.mocked(fetchEarnings).mockResolvedValue(result())
    renderSection()
    expect(await screen.findByText('Booked again with Same time next week: 0')).toBeInTheDocument()
  })

  it('is not a heading and sits outside the Collected and Coming up headings', async () => {
    renderSection()
    const line = await screen.findByText('Booked again with Same time next week: 3')
    expect(line.closest('h1, h2, h3, h4')).toBeNull()
  })

  it('follows the selected period', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByText('Booked again with Same time next week: 3')
    vi.mocked(fetchEarnings).mockResolvedValue(result({ from: '2026-10-19', to: TODAY, rebooked: { count: 7 } }))
    await user.click(screen.getByRole('button', { name: 'This week' }))
    expect(await screen.findByText('Booked again with Same time next week: 7')).toBeInTheDocument()
    expect(screen.queryByText('Booked again with Same time next week: 3')).not.toBeInTheDocument()
  })
})
