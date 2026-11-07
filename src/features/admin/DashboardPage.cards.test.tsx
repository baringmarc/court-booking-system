// T17.30: the dashboard's "Today's bookings" and "Next booking" cards, the no-courts empty state and the
// hours line in the empty schedule.
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  courts: [] as unknown[],
  bookings: [] as unknown[],
  periods: [] as unknown[],
  bookingsError: null as Error | null,
  refetch: undefined as unknown as ReturnType<typeof vi.fn>,
}))
const query = (data: unknown) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn() })

vi.mock('../venue/useVenue', () => ({ useVenue: () => ({ id: 'venue-a', slug: 'a-venue', status: 'active' }) }))
vi.mock('../catalog/hooks', () => ({
  useVenueSettings: () => query({ timezone: 'Asia/Manila', currency: 'PHP' }),
  useCourts: () => query(h.courts),
  useOperatingHours: () => query([]),
  useStaffSchedule: (date: string) => query(date === '2030-01-07' ? h.periods : []),
}))
vi.mock('./hooks', () => ({
  useAdminBookings: (filters: { date: string }) => h.bookingsError
    ? { data: undefined, isPending: false, isError: true, error: h.bookingsError, refetch: h.refetch }
    : query({ bookings: filters.date === '2030-01-07' ? h.bookings : [] }),
  useProofQueueCount: () => query(0),
}))
vi.mock('../booking/hooks', () => ({ useAvailability: () => query([]) }))
vi.mock('../openPlay/hooks', () => ({ useUpcomingOpenPlay: () => query([]) }))
// 10:30 in Manila on Monday 2030-01-07.
vi.mock('../booking/useNow', () => ({ useNow: () => new Date('2030-01-07T02:30:00.000Z') }))
vi.mock('./EarningsSection', () => ({ EarningsSection: () => null }))
vi.mock('./DayView', () => ({ DayView: () => <p>day view</p> }))

const at = (hour: number) => new Date(Date.UTC(2030, 0, 7, hour - 8)).toISOString()
const booking = (id: string, from: number, to: number, court: string, guest: string) => ({
  id, slot_start: at(from), slot_end: at(to), court_name: court, guest_name: guest, reference_code: `CB-${id}`,
  status: 'confirmed', expires_at: null, source: 'online',
})
const court = { id: 'c1', name: 'Court A', sport: 'tennis', is_active: true }
const dayPeriod = { court_id: 'c1', operating_date: '2030-01-07', period_start: at(6), period_end: at(22) }

async function renderDashboard() {
  const { DashboardPage } = await import('./DashboardPage')
  render(<MemoryRouter><DashboardPage /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Proofs to review' })
}
const paragraph = (text: string) => (_: string, el: Element | null) => el?.tagName === 'P' && el.textContent?.replace(/\s+/g, ' ').trim() === text
const card = (name: string) => within(screen.getByRole('heading', { name }).closest('section')!)

describe('DashboardPage cards (T17.30)', () => {
  beforeEach(() => {
    h.courts = [court]
    h.periods = [dayPeriod]
    h.bookings = [booking('1', 8, 9, 'Court A', 'Past Guest'), booking('2', 10, 11, 'Court A', 'Current Guest'), booking('3', 14, 15, 'Court B', 'Later Guest')]
    h.bookingsError = null
    h.refetch = vi.fn()
  })

  it("the Today's bookings card counts today's active bookings and links to the bookings page", async () => {
    await renderDashboard()
    const c = card("Today's bookings")
    expect(c.getByText('3')).toBeInTheDocument()
    expect(c.getByRole('link', { name: 'Open bookings' })).toHaveAttribute('href', '/admin/bookings')
  })

  it('the Next booking card shows the booking in progress first, with its court and guest', async () => {
    await renderDashboard()
    const c = card('Next booking')
    expect(c.getByText(/10 AM–11 AM/)).toBeInTheDocument()
    expect(c.getByText(/Court A/)).toBeInTheDocument()
    expect(c.getByText(/Current Guest/)).toBeInTheDocument()
    expect(c.queryByText(/Past Guest/)).not.toBeInTheDocument()
    expect(c.getByRole('link', { name: 'Open bookings' })).toHaveAttribute('href', '/admin/bookings')
  })

  it('the Next booking card skips ended bookings and says when none are left', async () => {
    h.bookings = [booking('1', 8, 9, 'Court A', 'Past Guest')]
    await renderDashboard()
    expect(card('Next booking').getByText('No more bookings today')).toBeInTheDocument()
    expect(card("Today's bookings").getByText('1')).toBeInTheDocument()
  })

  it('both cards show the error with a retry when the bookings fail to load', async () => {
    h.bookingsError = new Error('boom')
    await renderDashboard()
    expect(card("Today's bookings").getByRole('button', { name: /retry|try again/i })).toBeInTheDocument()
    expect(card('Next booking').getByRole('button', { name: /retry|try again/i })).toBeInTheDocument()
  })

  it('a venue without courts sees "No courts yet." and an Add court link instead of the day view', async () => {
    h.courts = []
    await renderDashboard()
    expect(screen.getByText('No courts yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add court' })).toHaveAttribute('href', '/admin/courts/new')
    expect(screen.queryByText('day view')).not.toBeInTheDocument()
  })

  it('a venue with courts still shows the day view', async () => {
    await renderDashboard()
    expect(await screen.findByText('day view')).toBeInTheDocument()
    expect(screen.queryByText('No courts yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Add court' })).not.toBeInTheDocument()
  })

  it("the empty schedule says no bookings and today's hours", async () => {
    h.bookings = []
    await renderDashboard()
    expect(await screen.findByText(paragraph('No bookings today. Open 6 AM – 10 PM'))).toBeInTheDocument()
  })

  it('the empty schedule says Closed today when no court is open', async () => {
    h.bookings = []
    h.periods = []
    await renderDashboard()
    expect(await screen.findByText(paragraph('No bookings today. Closed today'))).toBeInTheDocument()
  })
})
