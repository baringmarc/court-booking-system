// T31.1: the "Slots image" control sits in the dashboard's Today's courts card, and only when there are courts.
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ courts: [] as unknown[], periods: [] as unknown[] }))
const query = (data: unknown) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn() })

vi.mock('../venue/useVenue', () => ({ useVenue: () => ({ id: 'venue-a', slug: 'a-venue', status: 'active' }) }))
vi.mock('../catalog/hooks', () => ({
  useVenueSettings: () => query({ timezone: 'Asia/Manila', currency: 'PHP' }),
  useCourts: () => query(h.courts),
  useStaffSchedule: (date: string) => query(date === '2030-01-07' ? h.periods : []),
}))
vi.mock('./hooks', () => ({
  useAdminBookings: () => query({ bookings: [] }),
  useProofQueueCount: () => query(0),
  useRefundsOwedCount: () => query(0),
}))
vi.mock('../booking/hooks', () => ({ useAvailability: () => query([]) }))
vi.mock('../openPlay/hooks', () => ({ useUpcomingOpenPlay: () => query([]) }))
vi.mock('../booking/useNow', () => ({ useNow: () => new Date('2030-01-07T02:30:00.000Z') }))
vi.mock('./EarningsSection', () => ({ EarningsSection: () => null }))
vi.mock('./DayView', () => ({ DayView: () => <p>day view</p> }))

const at = (hour: number) => new Date(Date.UTC(2030, 0, 7, hour - 8)).toISOString()
const court = { id: 'c1', name: 'Court A', sport: 'tennis', is_active: true }
const dayPeriod = { court_id: 'c1', operating_date: '2030-01-07', period_start: at(6), period_end: at(22) }

async function renderDashboard() {
  const { DashboardPage } = await import('./DashboardPage')
  render(<MemoryRouter><DashboardPage /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Proofs to review' })
}

describe('DashboardPage slots image (T31.1)', () => {
  beforeEach(() => {
    h.courts = [court]
    h.periods = [dayPeriod]
  })

  it("the Slots image control is inside the Today's courts card when there are courts", async () => {
    await renderDashboard()
    const card = within(screen.getByRole('heading', { name: "Today's courts" }).closest('section')!)
    expect(card.getByRole('group', { name: 'Slots image' })).toBeInTheDocument()
    expect(card.getByRole('button', { name: 'Download image' })).toBeInTheDocument()
  })

  it('is not rendered when there are no courts', async () => {
    h.courts = []
    await renderDashboard()
    expect(screen.queryByRole('group', { name: 'Slots image' })).not.toBeInTheDocument()
  })
})
