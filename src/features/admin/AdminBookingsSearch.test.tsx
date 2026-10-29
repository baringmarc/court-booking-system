// /admin/bookings search (T11.5b): the filters the page asks for, the "searching all bookings" note, a whole code
// opening its booking, nothing found, and an error.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { fetchVenueSettings, type VenueSettings } from '../catalog/api'
import { AdminBookingsPage } from './AdminBookingsPage'
import { fetchActiveMovedParts, fetchAdminBookings, type AdminBooking } from './api'

vi.mock('../catalog/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchVenueSettings: vi.fn() }))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchAdminBookings: vi.fn(),
  fetchActiveMovedParts: vi.fn(),
}))

const booking = (reference_code: string, guest_name: string): AdminBooking => ({
  id: reference_code, reference_code, court_id: 'c1', court_name: 'Badminton 1', sport: 'badminton',
  slot_start: '2030-01-07T10:00:00.000Z', slot_end: '2030-01-07T11:00:00.000Z', status: 'confirmed', source: 'online',
  total_amount: 350, booking_fee: 0, amount_due: 350, expires_at: null, rejection_count: 0, guest_name, guest_email: 'ana@example.com', guest_phone: null,
  created_at: '2030-01-01T00:00:00.000Z', payments: [], cancelled_at: null, cancel_reason: null, cancelled_by_venue: false,
  parent_booking_id: null,
})

function renderPage(path = '/admin/bookings') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><AdminBookingsPage /></MemoryRouter></QueryClientProvider>)
}

describe('AdminBookingsPage search', () => {
  beforeEach(() => {
    vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila', currency: 'PHP' } as VenueSettings)
    vi.mocked(fetchAdminBookings).mockReset().mockResolvedValue({ bookings: [], truncated: false })
    vi.mocked(fetchActiveMovedParts).mockReset().mockResolvedValue([])
  })

  it('searches all bookings, says so, and opens the booking a whole code finds', async () => {
    vi.mocked(fetchAdminBookings).mockResolvedValue({ bookings: [booking('CB-7KQ2XD', 'Ana Santos')], truncated: false })
    renderPage()
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search' }), 'cb-7kq2xd{Enter}')
    await vi.waitFor(() => expect(fetchAdminBookings).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'cb-7kq2xd', status: 'payment_submitted' }), 'Asia/Manila'))
    expect(screen.getByRole('status')).toHaveTextContent('Searching all bookings for “cb-7kq2xd”. The status, source and date filters are set aside.')
    const row = await within(screen.getByRole('list', { name: 'Bookings' })).findByRole('button', { pressed: true })
    expect(row).toHaveTextContent('CB-7KQ2XD')
  })

  it('says when nothing matches, and Clear goes back to the filters', async () => {
    renderPage('/admin/bookings?q=zzz')
    expect(await screen.findByText('No bookings match “zzz”.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    await vi.waitFor(() => expect(fetchAdminBookings).toHaveBeenLastCalledWith(expect.objectContaining({ q: '' }), 'Asia/Manila'))
    expect(screen.queryByText(/Searching all bookings/)).toBeNull()
    expect(await screen.findByText('No proofs are waiting for review.')).toBeInTheDocument()
  })

  it('shows the error when the search fails', async () => {
    vi.mocked(fetchAdminBookings).mockRejectedValue(new ApiError('Could not load bookings.', '500'))
    renderPage('/admin/bookings?q=ana')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('passes the chosen sort to the query', async () => {
    renderPage('/admin/bookings?status=all&sort=booked-desc')
    await vi.waitFor(() => expect(fetchAdminBookings).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'all', sort: 'booked-desc' }), 'Asia/Manila'))
    expect(screen.getByLabelText('Sort by')).toHaveValue('booked-desc')
  })
})
