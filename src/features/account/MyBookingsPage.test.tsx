import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import { fetchVenueSettings, type VenueSettings } from '../catalog/api'
import { claimGuestBookings, fetchMyBookings, type MyBooking } from './api'
import { GuestBookingClaimer } from './GuestBookingClaimer'
import { MyBookingsPage } from './MyBookingsPage'

vi.mock('./api', () => ({ fetchMyBookings: vi.fn(), claimGuestBookings: vi.fn() }))
vi.mock('../catalog/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchVenueSettings: vi.fn() }))

const settings = { timezone: 'Asia/Manila', currency: 'PHP' } as VenueSettings
const booking = (ref: string, startIso: string, overrides: Partial<MyBooking> = {}): MyBooking => ({
  id: ref, reference_code: ref, court_name: 'Badminton 1', sport: 'badminton',
  slot_start: startIso, slot_end: new Date(Date.parse(startIso) + 3_600_000).toISOString(),
  status: 'confirmed', expires_at: null, total_amount: 450, parent_booking_id: null, created_at: '2030-01-01T00:00:00Z', ...overrides,
})
const confirmedPlayer = () => authState('player', {
  user: { id: 'player-id', email: 'player@example.com', email_confirmed_at: '2030-01-01T00:00:00Z' } as User,
})

function renderPage(ui = <MyBookingsPage />, auth = confirmedPlayer()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter>{ui}</MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

describe('MyBookingsPage', () => {
  beforeEach(() => {
    vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue(settings)
    vi.mocked(fetchMyBookings).mockReset()
    vi.mocked(claimGuestBookings).mockReset().mockResolvedValue(0)
  })

  it('sorts by when they were booked from the "Sort by" select (T11.5b)', async () => {
    vi.mocked(fetchMyBookings).mockResolvedValue([
      booking('CB-SOONAA', '2099-01-08T10:00:00.000Z', { created_at: '2030-01-05T00:00:00Z' }),
      booking('CB-LATEAA', '2099-01-09T10:00:00.000Z', { created_at: '2030-01-07T00:00:00Z' }),
    ])
    renderPage()
    const refs = () => within(screen.getByRole('list', { name: 'Upcoming bookings' })).getAllByRole('link').map((a) => a.textContent?.match(/CB-\w+/)?.[0])
    await screen.findByRole('list', { name: 'Upcoming bookings' })
    expect(screen.getByLabelText('Sort by')).toHaveValue('play')
    expect(refs()).toEqual(['CB-SOONAA', 'CB-LATEAA'])
    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'booked-desc')
    expect(refs()).toEqual(['CB-LATEAA', 'CB-SOONAA'])
  })

  it('shows a loader while bookings load', () => {
    vi.mocked(fetchMyBookings).mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('splits upcoming from past and links each booking', async () => {
    vi.mocked(fetchMyBookings).mockResolvedValue([
      booking('CB-PASTAA', '2020-01-06T10:00:00.000Z'),
      booking('CB-NEXTAA', '2099-01-08T10:00:00.000Z', { status: 'payment_submitted' }),
      booking('CB-GONEAA', '2099-01-09T10:00:00.000Z', { status: 'cancelled' }),
    ])
    renderPage()
    const upcoming = await screen.findByRole('list', { name: 'Upcoming bookings' })
    expect(within(upcoming).getByRole('link', { name: /CB-NEXTAA/ })).toHaveAttribute('href', '/booking/CB-NEXTAA')
    expect(within(upcoming).getByText('Payment under review')).toBeInTheDocument()
    const past = screen.getByRole('list', { name: 'Past bookings' })
    expect(within(past).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/booking/CB-GONEAA', '/booking/CB-PASTAA'])
    expect(within(past).getByText('Completed')).toBeInTheDocument()
    expect(within(past).getByText('Cancelled')).toBeInTheDocument()
    expect(fetchMyBookings).toHaveBeenCalledWith('player-id')
  })

  it('labels a moved part with the booking it was split from', async () => {
    vi.mocked(fetchMyBookings).mockResolvedValue([
      booking('CB-ROOTAA', '2099-01-08T10:00:00.000Z'),
      booking('CB-MOVEDA', '2099-01-09T10:00:00.000Z', { parent_booking_id: 'CB-ROOTAA' }),
      booking('CB-ORPHAN', '2099-01-10T10:00:00.000Z', { parent_booking_id: 'gone' }),
    ])
    renderPage()
    const upcoming = await screen.findByRole('list', { name: 'Upcoming bookings' })
    expect(within(upcoming).getByRole('link', { name: /CB-MOVEDA.*Moved part of CB-ROOTAA/ })).toBeInTheDocument()
    expect(within(upcoming).getByRole('link', { name: /CB-ORPHAN.*Moved part(?! of)/ })).toBeInTheDocument()
    const root = within(upcoming).getAllByRole('link').find((a) => a.getAttribute('href') === '/booking/CB-ROOTAA')!
    expect(root).not.toHaveTextContent('Moved part')
  })

  it('has an empty state with a way to book', async () => {
    vi.mocked(fetchMyBookings).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('You have no bookings yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Book a court' })).toHaveAttribute('href', '/book')
  })

  it('shows an error with a retry', async () => {
    vi.mocked(fetchMyBookings).mockRejectedValueOnce(new Error('Network down')).mockResolvedValue([])
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /try again/i }))
    expect(await screen.findByText('You have no bookings yet.')).toBeInTheDocument()
  })

  it('says how many guest bookings were just added', async () => {
    vi.mocked(fetchMyBookings).mockResolvedValue([])
    vi.mocked(claimGuestBookings).mockResolvedValue(2)
    renderPage()
    expect(await screen.findByText('We added 2 earlier bookings made with your email.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/We added 2 earlier bookings/)).not.toBeInTheDocument()
  })
})

describe('GuestBookingClaimer', () => {
  // A block body: a function returned from beforeEach is run as cleanup (it would call the mock again).
  beforeEach(() => {
    vi.mocked(claimGuestBookings).mockReset().mockResolvedValue(0)
  })

  it('claims once for a signed-in player with a confirmed email', async () => {
    renderPage(<><GuestBookingClaimer /><GuestBookingClaimer /></>)
    await vi.waitFor(() => expect(claimGuestBookings).toHaveBeenCalledTimes(1))
  })

  it('does nothing when signed out or the email is unconfirmed', async () => {
    renderPage(<GuestBookingClaimer />, authState('anon'))
    renderPage(<GuestBookingClaimer />, authState('player')) // the fake user has no email_confirmed_at
    await new Promise((r) => setTimeout(r, 20))
    expect(claimGuestBookings).not.toHaveBeenCalled()
  })
})
