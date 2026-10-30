// T11.28: "Collected by method" names payment accounts by their label.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPlatformFee } from '../booking/api'
import { fetchEarnings } from './api'
import { EarningsSection } from './EarningsSection'

vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchEarnings: vi.fn() }))
vi.mock('../booking/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchPlatformFee: vi.fn() }))

const TODAY = '2026-10-25'
const hours = { open_hours: 16, blackout_hours: 0, sold_hours: 1, open_play_hours: 0 }

beforeEach(() => {
  vi.mocked(fetchPlatformFee).mockReset().mockResolvedValue(0)
  vi.mocked(fetchEarnings).mockReset().mockResolvedValue({
    from: TODAY, to: TODAY, timezone: 'Asia/Manila',
    collected: {
      total: 1500, count: 4,
      by_method: [
        { method: 'account', paid_with: 'BPI Savings', amount: 900, count: 2 },
        { method: 'gcash', paid_with: null, amount: 400, count: 1 },
        { method: 'paymongo', paid_with: null, amount: 200, count: 1 },
      ],
    },
    previous: { from: '2026-10-24', to: '2026-10-24', total: 0, count: 0, by_method: [] },
    refunds_due: { count: 0, total: 0 },
    daily: [{ date: TODAY, collected: 1500, sold_hours: 1 }],
    courts: [{ court_id: 'A', name: 'Badminton 1', sport: 'badminton', ...hours }],
    sports: [{ sport: 'badminton', ...hours }],
    coming_up: { count: 0, value: 0 },
    split: {
      total_revenue: 1500, plotline_fees: 0, owner_earnings: 1500,
      previous: { total_revenue: 0, plotline_fees: 0, owner_earnings: 0 },
    },
  })
})

describe('EarningsSection paid with', () => {
  it('lists an account payment under its label and the rest under their method', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><EarningsSection today={TODAY} timeZone="Asia/Manila" currency="PHP" /></QueryClientProvider>)
    const list = await screen.findByRole('list', { name: 'Collected by method' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'BPI Savings (2)₱900', 'GCash (1)₱400', 'PayMongo (1)₱200',
    ])
  })
})
