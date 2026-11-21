// T27.7: the owner dashboard puts today first (fixed section order) and its cards link to the filtered bookings page.
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bookings: [] as unknown[],
  queue: 0,
  walkIns: false,
}))
const query = (data: unknown) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn() })

vi.mock('../venue/useVenue', () => ({ useVenue: () => ({ id: 'venue-a', slug: 'a-venue', status: 'active' }) }))
vi.mock('../catalog/hooks', () => ({
  useVenueSettings: () => query({ timezone: 'Asia/Manila', currency: 'PHP', walk_ins_enabled: h.walkIns }),
  useCourts: () => query([{ id: 'c1', name: 'Court A', sport: 'tennis', is_active: true }]),
  useOperatingHours: () => query([]),
  useStaffSchedule: (date: string) => query(date === '2030-01-07'
    ? [{ court_id: 'c1', operating_date: '2030-01-07', period_start: new Date(Date.UTC(2030, 0, 6, 22)).toISOString(), period_end: new Date(Date.UTC(2030, 0, 7, 14)).toISOString() }]
    : []),
}))
vi.mock('./hooks', () => ({
  useAdminBookings: (filters: { date: string }) => query({ bookings: filters.date === '2030-01-07' ? h.bookings : [] }),
  useProofQueueCount: () => query(h.queue),
  useRefundsOwedCount: () => query(0),
}))
vi.mock('../booking/hooks', () => ({ useAvailability: () => query([]) }))
vi.mock('../openPlay/hooks', () => ({ useUpcomingOpenPlay: () => query([]) }))
// 10:30 in Manila on Monday 2030-01-07.
vi.mock('../booking/useNow', () => ({ useNow: () => new Date('2030-01-07T02:30:00.000Z') }))
vi.mock('./EarningsSection', () => ({ EarningsSection: () => <h2>Earnings</h2> }))
vi.mock('./DayView', () => ({ DayView: () => <p>day view</p> }))
vi.mock('./WalkInSection', () => ({ WalkInSection: () => <h2>Walk-in booking</h2> }))

const at = (hour: number) => new Date(Date.UTC(2030, 0, 7, hour - 8)).toISOString()
const booking = (id: string, from: number, to: number) => ({
  id, slot_start: at(from), slot_end: at(to), court_name: 'Court A', guest_name: `Guest ${id}`, reference_code: `CB-${id}`,
  status: 'confirmed', expires_at: null, source: 'online',
})

async function renderDashboard() {
  const { DashboardPage } = await import('./DashboardPage')
  render(<MemoryRouter><DashboardPage /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Proofs to review' })
  await screen.findByRole('heading', { name: 'Earnings' })
}
const card = (name: string) => within(screen.getByRole('heading', { name }).closest('section')!)
const headings = () => screen.getAllByRole('heading', { level: 2 }).map((el) => el.textContent ?? '')

describe('DashboardPage today-first order and links (T27.7)', () => {
  beforeEach(() => {
    h.bookings = [booking('2', 10, 11), booking('3', 14, 15)]
    h.queue = 0
    h.walkIns = false
  })

  it('shows proofs, bookings, next booking, courts, schedule, then earnings last', async () => {
    await renderDashboard()
    const order = headings()
    expect(order.map((t) => t.replace(/ · .*/, ''))).toEqual([
      'Proofs to review', "Today's bookings", 'Next booking', 'Refunds owed', "Today's courts", "Today's schedule", 'Earnings',
    ])
  })

  it('puts the walk-in section after Next booking and before Today\'s courts when walk-ins are on', async () => {
    h.walkIns = true
    await renderDashboard()
    await screen.findByRole('heading', { name: 'Walk-in booking' })
    expect(headings().map((t) => t.replace(/ · .*/, ''))).toEqual([
      'Proofs to review', "Today's bookings", 'Next booking', 'Refunds owed', 'Walk-in booking', "Today's courts", "Today's schedule", 'Earnings',
    ])
  })

  it("the Today's bookings link opens all of today's bookings (status=all, the operating date)", async () => {
    await renderDashboard()
    expect(card("Today's bookings").getByRole('link', { name: 'Open bookings' }))
      .toHaveAttribute('href', '/admin/bookings?status=all&date=2030-01-07')
  })

  it('the Next booking link searches for that booking by its reference code', async () => {
    await renderDashboard()
    expect(card('Next booking').getByRole('link', { name: 'Open bookings' })).toHaveAttribute('href', '/admin/bookings?q=CB-2')
  })

  it('the Next booking link falls back to the plain bookings page when none are left', async () => {
    h.bookings = [booking('1', 8, 9)]
    await renderDashboard()
    expect(card('Next booking').getByText('No more bookings today')).toBeInTheDocument()
    expect(card('Next booking').getByRole('link', { name: 'Open bookings' })).toHaveAttribute('href', '/admin/bookings')
  })

  it('Proofs to review links to the default queue, saying "Review proofs" only when there are some', async () => {
    h.queue = 3
    await renderDashboard()
    expect(card('Proofs to review').getByRole('link', { name: 'Review proofs' })).toHaveAttribute('href', '/admin/bookings')
  })

  it('Proofs to review says "Open bookings" when the queue is empty', async () => {
    await renderDashboard()
    expect(card('Proofs to review').getByRole('link', { name: 'Open bookings' })).toHaveAttribute('href', '/admin/bookings')
  })
})
