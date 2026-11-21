// T30.6: /admin/bookings with refunds: the owed badge on a row, the Refund card under the booking panel, saving
// through update_refund with today's date in venue time, the refund filter and its empty text.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { fetchVenueSettings, type VenueSettings } from '../catalog/api'
import { AdminBookingsPage } from './AdminBookingsPage'
import { fetchActiveMovedParts, fetchAdminBookings, updateRefund, type AdminBooking, type AdminRefund } from './api'

vi.mock('../catalog/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchVenueSettings: vi.fn() }))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchAdminBookings: vi.fn(),
  fetchActiveMovedParts: vi.fn(),
  updateRefund: vi.fn(),
}))

const owed: AdminRefund = {
  id: 'r1', payment_id: 'p1', amount: 350, status: 'owed', method: null, settled_on: null, reason: null, note: null,
  updated_at: '2030-01-07T02:00:00.000Z',
}
const booking = (refunds: AdminRefund[]): AdminBooking => ({
  id: 'b1', reference_code: 'CB-7KQ2XD', court_id: 'c1', court_name: 'Badminton 1', sport: 'badminton',
  slot_start: '2030-01-07T10:00:00.000Z', slot_end: '2030-01-07T11:00:00.000Z', status: 'cancelled', source: 'online',
  total_amount: 350, booking_fee: 0, amount_due: 350, expires_at: null, rejection_count: 0, guest_name: 'Ana Santos',
  guest_email: 'ana@example.com', guest_phone: null, created_at: '2030-01-01T00:00:00.000Z',
  payments: [{
    id: 'p1', method: 'gcash', amount: 350, reference_number: '1234', storage_path: null, submitted_at: '2030-01-05T02:00:00.000Z',
    review_status: 'approved', review_note: null, reviewed_at: '2030-01-05T03:00:00.000Z', reviewed_by: 'admin-1',
    provider_payment_id: null, provider_source: null,
  }],
  cancelled_at: '2030-01-06T01:00:00.000Z', cancel_reason: 'Rain', cancelled_by_venue: true, parent_booking_id: null, refunds,
})

function renderPage(path = '/admin/bookings?status=all') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><AdminBookingsPage /></MemoryRouter></QueryClientProvider>)
}
const list = async () => within(await screen.findByRole('list', { name: 'Bookings' }))
const openBooking = async () => userEvent.click(await screen.findByRole('button', { name: /CB-7KQ2XD/ }))

describe('AdminBookingsPage refunds (T30.6)', () => {
  beforeEach(() => {
    // 4 AM on 2030-01-07 in Manila is still 2030-01-06 (8 PM) in UTC: "today" for the refund date is the venue's.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-01-06T20:00:00.000Z'))
    vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila', currency: 'PHP' } as VenueSettings)
    vi.mocked(fetchAdminBookings).mockReset().mockResolvedValue({ bookings: [booking([owed])], truncated: false })
    vi.mocked(fetchActiveMovedParts).mockReset().mockResolvedValue([])
    vi.mocked(updateRefund).mockReset().mockResolvedValue(undefined)
  })
  afterEach(() => { vi.useRealTimers() })

  it('marks a row with an owed refund, and no longer says "Refund due"', async () => {
    renderPage()
    const rows = await list()
    const badge = await rows.findByText('Refund owed')
    expect(badge).toHaveClass('badge', 'review-rejected')
    expect(rows.queryByText('Refund due')).not.toBeInTheDocument()
  })

  it('shows no refund badge once the refund is settled', async () => {
    vi.mocked(fetchAdminBookings).mockResolvedValue({
      bookings: [booking([{ ...owed, status: 'settled', method: 'gcash', settled_on: '2030-01-06' }])], truncated: false,
    })
    renderPage()
    const rows = await list()
    await rows.findByText('CB-7KQ2XD')
    expect(rows.queryByText(/^Refund owed$|^Refunded$|^Refund due$/)).not.toBeInTheDocument()
  })

  it('opens the Refund card under the booking panel, and the panel no longer tells staff to refund outside the app', async () => {
    renderPage()
    await openBooking()
    const card = await screen.findByRole('region', { name: 'Refund' })
    expect(within(card).getByText('Refund owed', { selector: '.badge' })).toBeInTheDocument()
    const panel = screen.getByRole('region', { name: 'Booking CB-7KQ2XD' })
    expect(panel.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText(/Cancelled by staff/)).toBeInTheDocument()
    expect(screen.queryByText(/Cancelled after payment/)).not.toBeInTheDocument()
    expect(screen.queryByText(/outside the app/)).not.toBeInTheDocument()
  })

  it('shows no Refund card for a booking without a refund', async () => {
    vi.mocked(fetchAdminBookings).mockResolvedValue({ bookings: [booking([])], truncated: false })
    renderPage()
    await openBooking()
    await screen.findByRole('region', { name: 'Booking CB-7KQ2XD' })
    expect(screen.queryByRole('region', { name: 'Refund' })).not.toBeInTheDocument()
  })

  it("Mark refunded saves through update_refund with today's date in venue time", async () => {
    renderPage()
    await openBooking()
    await userEvent.click(await screen.findByRole('button', { name: 'Mark refunded' }))
    expect(screen.getByLabelText('Date refunded')).toHaveValue('2030-01-07')
    await userEvent.selectOptions(screen.getByLabelText('Refunded by'), 'gcash')
    await userEvent.click(screen.getByRole('button', { name: 'Save refund' }))
    await vi.waitFor(() => expect(updateRefund).toHaveBeenCalledOnce())
    const input = vi.mocked(updateRefund).mock.calls[0][0]
    expect(input).toEqual({ refundId: 'r1', status: 'settled', amount: 350, method: 'gcash', settledOn: '2030-01-07' })
    expect('note' in input).toBe(false)
  })

  it('shows the server error in the card when saving fails', async () => {
    vi.mocked(updateRefund).mockRejectedValue(new ApiError('Choose how the refund was made.', 'P0001', 'missing_method'))
    renderPage()
    await openBooking()
    await userEvent.click(await screen.findByRole('button', { name: 'Mark refunded' }))
    await userEvent.selectOptions(screen.getByLabelText('Refunded by'), 'cash')
    await userEvent.click(screen.getByRole('button', { name: 'Save refund' }))
    expect(await within(screen.getByRole('region', { name: 'Refund' })).findByRole('alert'))
      .toHaveTextContent('Choose how the refund was made.')
  })

  it('Reopen as owed on a settled refund calls update_refund with the owed status', async () => {
    vi.mocked(fetchAdminBookings).mockResolvedValue({
      bookings: [booking([{ ...owed, status: 'settled', method: 'gcash', settled_on: '2030-01-06' }])], truncated: false,
    })
    renderPage()
    await openBooking()
    await userEvent.click(await screen.findByRole('button', { name: 'Reopen as owed' }))
    await vi.waitFor(() => expect(updateRefund).toHaveBeenCalledOnce())
    expect(vi.mocked(updateRefund).mock.calls[0][0]).toEqual({ refundId: 'r1', status: 'owed' })
  })

  it('reads the refund filter from the URL, shows it in the select and asks for it', async () => {
    renderPage('/admin/bookings?status=all&refund=owed')
    await vi.waitFor(() => expect(fetchAdminBookings).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'all', refund: 'owed' }), 'Asia/Manila'))
    expect(screen.getByLabelText('Refunds', { exact: true })).toHaveDisplayValue('Refund owed')
  })

  it('picking Refund owed in the select asks for the refund filter', async () => {
    renderPage()
    await userEvent.selectOptions(await screen.findByLabelText('Refunds', { exact: true }), 'owed')
    await vi.waitFor(() => expect(fetchAdminBookings).toHaveBeenLastCalledWith(expect.objectContaining({ refund: 'owed' }), 'Asia/Manila'))
  })

  it('says no bookings with a refund owed match when the refund filter finds nothing', async () => {
    vi.mocked(fetchAdminBookings).mockResolvedValue({ bookings: [], truncated: false })
    renderPage('/admin/bookings?status=all&refund=owed')
    expect(await screen.findByText('No bookings with a refund owed match these filters.')).toBeInTheDocument()
  })

  it('keeps the plain empty text without the refund filter', async () => {
    vi.mocked(fetchAdminBookings).mockResolvedValue({ bookings: [], truncated: false })
    renderPage('/admin/bookings?status=all')
    expect(await screen.findByText('No bookings match these filters.')).toBeInTheDocument()
  })
})
