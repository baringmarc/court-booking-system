// T33.4: /me/bookings shows the courts of one checkout as one entry (SPEC §7 `/me/bookings`, "Groups"): one link to the
// earliest-starting court's page, the title "N courts", one line per court, the checkout's total and the group's badge.
// Times are fixed in 2099 (always ahead) and in Asia/Manila: Badminton 1 at 7 AM Thu, Jan 8 (the previous UTC day),
// Tennis Court at 11 PM the same day.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import { fetchVenueSettings, type VenueSettings } from '../catalog/api'
import { claimGuestBookings, fetchMyBookings, type MyBooking } from './api'
import { MyBookingsPage } from './MyBookingsPage'

vi.mock('./api', () => ({ fetchMyBookings: vi.fn(), claimGuestBookings: vi.fn() }))
vi.mock('../catalog/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchVenueSettings: vi.fn() }))

const settings = { timezone: 'Asia/Manila', currency: 'PHP' } as VenueSettings
const booking = (ref: string, startIso: string, overrides: Partial<MyBooking> = {}): MyBooking => ({
  id: ref, reference_code: ref, court_name: 'Badminton 1', sport: 'badminton',
  slot_start: startIso, slot_end: new Date(Date.parse(startIso) + 3_600_000).toISOString(),
  status: 'confirmed', expires_at: null, amount_due: 450, parent_booking_id: null, created_at: '2030-01-01T00:00:00Z', ...overrides,
})
const lead = (overrides: Partial<MyBooking> = {}) =>
  booking('CB-LEAD01', '2099-01-07T23:00:00.000Z', { booking_group_id: 'g1', amount_due: 360, ...overrides })
const part = (overrides: Partial<MyBooking> = {}) =>
  booking('CB-PART02', '2099-01-08T15:00:00.000Z', {
    booking_group_id: 'g1', court_name: 'Tennis Court', sport: 'tennis', slot_end: '2099-01-08T17:00:00.000Z', amount_due: 700, ...overrides,
  })

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const auth = authState('player', { user: { id: 'player-id', email: 'player@example.com', email_confirmed_at: '2030-01-01T00:00:00Z' } as User })
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}><MemoryRouter><MyBookingsPage /></MemoryRouter></AuthContext.Provider>
    </QueryClientProvider>,
  )
}

describe('MyBookingsPage: a group is one entry', () => {
  beforeEach(() => {
    vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue(settings)
    vi.mocked(fetchMyBookings).mockReset()
    vi.mocked(claimGuestBookings).mockReset().mockResolvedValue(0)
  })

  it('links once to the earliest court’s page, titled "2 courts", with a line per court, the total and the badge', async () => {
    // Rows come latest first, as the API sorts them.
    vi.mocked(fetchMyBookings).mockResolvedValue([part({ status: 'pending_payment', expires_at: '2099-01-07T12:00:00.000Z' }), lead({ status: 'pending_payment', expires_at: '2099-01-07T12:00:00.000Z' })])
    renderPage()
    const upcoming = await screen.findByRole('list', { name: 'Upcoming bookings' })
    const links = within(upcoming).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '/booking/CB-LEAD01')
    expect(within(links[0]).getByText('2 courts')).toBeInTheDocument()
    expect(links[0]).toHaveTextContent('Badminton 1 · Thu, Jan 8, 7 AM–8 AM · CB-LEAD01')
    expect(links[0]).toHaveTextContent('Tennis Court · Thu, Jan 8, 11 PM–1 AM · CB-PART02')
    expect(links[0]).toHaveTextContent('₱1,060')
    expect(within(links[0]).getByText('Waiting for payment')).toHaveClass('badge', 'status-pending_payment')
  })

  it('does not show the courts as separate entries or repeat the lead as the title', async () => {
    vi.mocked(fetchMyBookings).mockResolvedValue([part(), lead()])
    renderPage()
    const upcoming = await screen.findByRole('list', { name: 'Upcoming bookings' })
    expect(within(upcoming).getAllByRole('listitem')).toHaveLength(1)
    expect(within(upcoming).queryByRole('link', { name: /^Tennis Court/ })).not.toBeInTheDocument()
    expect(within(upcoming).queryByText('Badminton 1', { selector: 'strong' })).not.toBeInTheDocument()
  })

  it('marks a cancelled court with " · Cancelled" and shows the group’s status, not the cancelled court’s', async () => {
    vi.mocked(fetchMyBookings).mockResolvedValue([part({ status: 'cancelled' }), lead({ status: 'confirmed' })])
    renderPage()
    const upcoming = await screen.findByRole('list', { name: 'Upcoming bookings' })
    const link = within(upcoming).getByRole('link')
    expect(link).toHaveTextContent('Tennis Court · Thu, Jan 8, 11 PM–1 AM · CB-PART02 · Cancelled')
    expect(link).not.toHaveTextContent('CB-LEAD01 · Cancelled')
    expect(within(link).getByText('Confirmed')).toHaveClass('badge')
    expect(within(link).queryByText('Cancelled', { selector: '.badge' })).not.toBeInTheDocument()
  })

  it('lists a fully cancelled group under Past with the Cancelled badge', async () => {
    vi.mocked(fetchMyBookings).mockResolvedValue([part({ status: 'cancelled' }), lead({ status: 'cancelled' })])
    renderPage()
    const past = await screen.findByRole('list', { name: 'Past bookings' })
    expect(within(past).getAllByRole('link')).toHaveLength(1)
    expect(within(past).getByText('Cancelled', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.getByText('Nothing coming up.', { exact: false })).toBeInTheDocument()
  })

  it('leaves a single booking as it was, next to a group', async () => {
    vi.mocked(fetchMyBookings).mockResolvedValue([
      booking('CB-SOLO09', '2099-01-10T10:00:00.000Z', { booking_group_id: null }),
      part(), lead(),
    ])
    renderPage()
    const upcoming = await screen.findByRole('list', { name: 'Upcoming bookings' })
    const links = within(upcoming).getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/booking/CB-LEAD01', '/booking/CB-SOLO09'])
    expect(within(links[1]).getByText('Badminton 1', { selector: 'strong' })).toBeInTheDocument()
    expect(links[1]).not.toHaveTextContent(/courts/)
  })
})
