// T33.4: BookingPage for a booking in a group: one proof form, one Pay online button, the proof's amount is the group's
// total, and the cancel is "Cancel all bookings" with the deadline at the earliest active start; it calls the existing
// cancelBooking once, with the opened booking's id. The api.ts functions are mocked; hooks, React Query and the router
// are real. Times are fixed in 2030 (the real clock is far before them) and in Asia/Manila.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import { fetchPaymentAccounts } from '../venue/api'
import { fetchVenueSettings, type VenueSettings } from '../catalog/api'
import { cancelBooking, fetchGuestBooking, fetchOwnBooking, type BookingDetail, type BookingGroup } from './api'
import { BookingPage } from './BookingPage'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchGuestBooking: vi.fn(),
  fetchOwnBooking: vi.fn(),
  cancelBooking: vi.fn(),
}))
vi.mock('../catalog/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchVenueSettings: vi.fn() }))
vi.mock('../venue/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchPaymentAccounts: vi.fn() }))

const REF = 'CB-PART02'
const TOKEN = 'secret-token'
const settings = {
  timezone: 'Asia/Manila', currency: 'PHP', payment_instructions: '**GCash**: 0917 000 0000', cancel_cutoff_hours: 1,
  address: '123 Rizal Ave, Makati', maps_url: 'https://maps.app.goo.gl/AbC123', online_payments_enabled: true,
} as VenueSettings

const group: BookingGroup = {
  id: 'g1', lead_reference_code: 'CB-LEAD01', total_amount: 1050, booking_fee: 10, amount_due: 1060,
  bookings: [
    { reference_code: 'CB-LEAD01', court_id: null, court_name: 'Badminton 1', sport: 'badminton', slot_start: '2030-01-06T23:00:00.000Z', slot_end: '2030-01-07T00:00:00.000Z',
      status: 'pending_payment', total_amount: 350, booking_fee: 10, amount_due: 360, refund: null },
    { reference_code: 'CB-PART02', court_id: null, court_name: 'Tennis Court', sport: 'tennis', slot_start: '2030-01-07T15:00:00.000Z', slot_end: '2030-01-07T17:00:00.000Z',
      status: 'pending_payment', total_amount: 700, booking_fee: 0, amount_due: 700, refund: null },
  ],
}

/** The page opened on the later court (Tennis Court, 11 PM); the group's earliest court starts at 7 AM on Jan 7. */
function opened(overrides: Partial<BookingDetail> = {}): BookingDetail {
  return {
    id: 'b2', reference_code: REF, court_id: 'c2', court_name: 'Tennis Court', sport: 'tennis',
    slot_start: '2030-01-07T15:00:00.000Z', slot_end: '2030-01-07T17:00:00.000Z',
    status: 'pending_payment', total_amount: 700, booking_fee: 0, amount_due: 700, waiver_text: null, waiver_accepted_at: null,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(), rejection_count: 0, guest_name: 'Gina Guest', guest_email: 'gina@example.com',
    created_at: new Date().toISOString(), payments: [], cancelled_at: null, cancel_reason: null, cancelled_by_venue: false, user_id: null,
    parent_reference_code: null, continuations: [], changes: [], refund: null, group,
    ...overrides,
  }
}

function renderPage(url = `/booking/${REF}#token=${TOKEN}`, auth = authState('anon')) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[url]}>
          <Routes><Route path="/booking/:ref" element={<BookingPage />} /></Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue(settings)
  vi.mocked(fetchPaymentAccounts).mockReset().mockResolvedValue([
    { id: 'a1', label: 'GCash', account_name: 'Claudex Courts', account_number: '0917 000 0000', qr_path: null, position: 0 },
  ])
  vi.mocked(fetchGuestBooking).mockReset().mockResolvedValue(opened())
  vi.mocked(fetchOwnBooking).mockReset().mockResolvedValue(opened())
  vi.mocked(cancelBooking).mockReset().mockResolvedValue(undefined)
})

describe('BookingPage for a group', () => {
  it('shows the whole checkout: "Your courts" with both courts and the group total', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Your courts' })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Courts in this booking' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Total', { selector: 'dt' }).nextElementSibling).toHaveTextContent('₱1,060')
    expect(screen.getByText('Reference', { selector: 'dt' }).nextElementSibling).toHaveTextContent('CB-LEAD01')
  })

  it('has one payment path: one Pay online button, one proof form, one payment account list', async () => {
    renderPage()
    expect(await screen.findAllByRole('button', { name: 'Pay online with PayMongo' })).toHaveLength(1)
    // The proof form appears once the venue's payment accounts have loaded.
    expect(await screen.findAllByRole('button', { name: 'Submit proof of payment' })).toHaveLength(1)
    expect(await screen.findAllByRole('list', { name: 'Payment accounts' })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Your courts' })).toBeInTheDocument()
  })

  it('starts the proof’s amount at the group’s amount due, not the opened court’s', async () => {
    renderPage()
    expect(await screen.findByLabelText('Amount paid')).toHaveValue(1060)
  })

  it('says "Cancel all bookings", with the deadline at the earliest active start (6 AM Jan 7 = 1 hour before 7 AM)', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: 'Cancel all bookings' })).toBeInTheDocument()
    expect(screen.getByText('This cancels all 2 courts.')).toBeInTheDocument()
    // The opened court starts at 11 PM; measuring from it would say 10:00 PM.
    expect(screen.getByText(/You can cancel online until Mon, Jan 7, 6:00 AM/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).not.toBeInTheDocument()
  })

  it('cancels once, through cancelBooking, with the opened booking’s id and the player’s reason', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel all bookings' }))
    expect(screen.getByText(/^Cancel all 2 bookings\? The times will be released for others to book\./)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Reason (optional)'), 'Plans changed')
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel all bookings' }))
    await vi.waitFor(() => expect(cancelBooking).toHaveBeenCalledTimes(1))
    expect(vi.mocked(cancelBooking).mock.calls[0][0]).toEqual({ bookingId: 'b2', referenceCode: REF, token: TOKEN, reason: 'Plans changed' })
  })

  it('counts only the courts still active: one court left reads as a single cancel', async () => {
    vi.mocked(fetchGuestBooking).mockResolvedValue(opened({
      status: 'confirmed', expires_at: null,
      group: { ...group, bookings: [{ ...group.bookings[0], status: 'cancelled' }, { ...group.bookings[1], status: 'confirmed' }] },
    }))
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Your courts' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Cancel booking' })).toBeInTheDocument()
    expect(screen.queryByText(/This cancels all/)).not.toBeInTheDocument()
    expect(screen.getByText(/You can cancel online until Mon, Jan 7, 10:00 PM/)).toBeInTheDocument()
  })

  it('reads the signed-in owner’s group through the owner path too', async () => {
    renderPage(`/booking/${REF}`, authState('player'))
    expect(await screen.findByRole('button', { name: 'Cancel all bookings' })).toBeInTheDocument()
    expect(fetchOwnBooking).toHaveBeenCalledWith(REF)
    expect(await screen.findAllByRole('button', { name: 'Submit proof of payment' })).toHaveLength(1)
  })
})
