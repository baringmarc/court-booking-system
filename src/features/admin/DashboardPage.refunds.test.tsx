// T30.6: the dashboard's "Refunds owed" card, after "Next booking": the count, a link to the filtered bookings, and
// its loading and error states.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  owed: { data: 0 as number | undefined, isPending: false, isError: false, error: null as Error | null },
  refetch: undefined as unknown as ReturnType<typeof vi.fn>,
}))
const query = (data: unknown) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn() })

vi.mock('../venue/useVenue', () => ({ useVenue: () => ({ id: 'venue-a', slug: 'a-venue', status: 'active' }) }))
vi.mock('../catalog/hooks', () => ({
  useVenueSettings: () => query({ timezone: 'Asia/Manila', currency: 'PHP' }),
  useCourts: () => query([]),
  useStaffSchedule: () => query([]),
}))
vi.mock('./hooks', () => ({
  useAdminBookings: () => query({ bookings: [] }),
  useProofQueueCount: () => query(0),
  useRefundsOwedCount: () => ({ ...h.owed, refetch: h.refetch }),
}))
vi.mock('../booking/hooks', () => ({ useAvailability: () => query([]) }))
vi.mock('../openPlay/hooks', () => ({ useUpcomingOpenPlay: () => query([]) }))
// 10:30 in Manila on Monday 2030-01-07.
vi.mock('../booking/useNow', () => ({ useNow: () => new Date('2030-01-07T02:30:00.000Z') }))
vi.mock('./EarningsSection', () => ({ EarningsSection: () => null }))
vi.mock('./DayView', () => ({ DayView: () => <p>day view</p> }))

async function renderDashboard() {
  const { DashboardPage } = await import('./DashboardPage')
  render(<MemoryRouter><DashboardPage /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Proofs to review' })
}
const card = () => within(screen.getByRole('heading', { name: 'Refunds owed' }).closest('section')!)

describe('DashboardPage Refunds owed card (T30.6)', () => {
  beforeEach(() => {
    h.owed = { data: 0, isPending: false, isError: false, error: null }
    h.refetch = vi.fn()
  })

  it('shows the number of refunds owed and links to the bookings that owe one', async () => {
    h.owed = { data: 3, isPending: false, isError: false, error: null }
    await renderDashboard()
    expect(card().getByText('3')).toHaveClass('big-number')
    expect(card().getByRole('link', { name: 'Open refunds' })).toHaveAttribute('href', '/admin/bookings?status=all&refund=owed')
  })

  it('shows 0 when none are owed, with the same link', async () => {
    await renderDashboard()
    expect(card().getByText('0')).toHaveClass('big-number')
    expect(card().getByRole('link', { name: 'Open refunds' })).toHaveAttribute('href', '/admin/bookings?status=all&refund=owed')
  })

  it('is a card after Next booking', async () => {
    await renderDashboard()
    const heads = screen.getAllByRole('heading', { level: 2 }).map((el) => el.textContent)
    expect(heads.indexOf('Refunds owed')).toBe(heads.indexOf('Next booking') + 1)
    expect(screen.getByRole('heading', { name: 'Refunds owed' }).closest('section')).toHaveClass('card')
  })

  it('shows a loader while the count loads', async () => {
    h.owed = { data: undefined, isPending: true, isError: false, error: null }
    await renderDashboard()
    expect(card().getByRole('status')).toHaveTextContent('Loading…')
    expect(card().queryByRole('link', { name: 'Open refunds' })).not.toBeInTheDocument()
  })

  it('shows the error with a retry when the count fails', async () => {
    h.owed = { data: undefined, isPending: false, isError: true, error: new Error('boom') }
    await renderDashboard()
    await userEvent.click(card().getByRole('button', { name: 'Try again' }))
    expect(h.refetch).toHaveBeenCalledOnce()
  })
})
