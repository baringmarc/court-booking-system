// T11.13: the booking page shows the court price, Plotline's booking fee and the total (amount_due), all as stored
// on the booking, and the manual proof amount starts at amount_due. BookingSummary is rendered on its own;
// BookingPage with its api.ts functions mocked (hooks, React Query and the router are real).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import { fetchVenueSettings, type VenueSettings } from '../catalog/api'
import { fetchPaymentAccounts } from '../venue/api'
import { fetchGuestBooking, fetchOwnBooking, type BookingDetail } from './api'
import { BookingPage } from './BookingPage'
import { BookingSummary } from './BookingSummary'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchGuestBooking: vi.fn(),
  fetchOwnBooking: vi.fn(),
  startPaymongoCheckout: vi.fn(),
}))
vi.mock('../catalog/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchVenueSettings: vi.fn() }))
vi.mock('../venue/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchPaymentAccounts: vi.fn() }))

const REF = 'CB-7KQ2XD'
const TOKEN = 'secret-token'

// 11 PM–midnight in Manila (3 PM–4 PM UTC): court price 900, fee 10, amount due 910.
const booking: BookingDetail = {
  id: 'b1', reference_code: REF, court_id: 'c1', court_name: 'Badminton 1', sport: 'badminton',
  slot_start: '2030-01-07T15:00:00.000Z', slot_end: '2030-01-07T16:00:00.000Z',
  status: 'pending_payment', total_amount: 900, booking_fee: 10, amount_due: 910, waiver_text: null, waiver_accepted_at: null,
  expires_at: '2030-01-07T03:00:00.000Z', rejection_count: 0, guest_name: 'Gina Guest', guest_email: 'gina@example.com',
  created_at: '2030-01-07T02:00:00.000Z', payments: [], cancelled_at: null, cancel_reason: null, cancelled_by_venue: false,
  user_id: null, parent_reference_code: null, continuations: [], changes: [],
}

function renderSummary(overrides: Partial<BookingDetail> = {}) {
  render(
    <BookingSummary booking={{ ...booking, ...overrides }} paymentInstructions="Pay by GCash" timeZone="Asia/Manila"
      currency="PHP" now={new Date('2030-01-07T02:30:00.000Z')} />,
  )
}

/** The value shown next to a label in the booking facts (the label and its value share a row). */
function amountFor(label: string) {
  const term = screen.getByText(label, { exact: true })
  return term.parentElement?.textContent?.replace(label, '').trim()
}

describe('BookingSummary: court price, booking fee and total (T11.13)', () => {
  it('shows the court price, the booking fee and the total from amount_due', () => {
    renderSummary()
    expect(amountFor('Court price')).toBe('₱900')
    expect(amountFor('Booking fee')).toBe('₱10')
    expect(amountFor('Total')).toBe('₱910')
    expect(screen.getByText('11 PM–12 AM (1 hour)')).toBeInTheDocument()
  })

  it('asks the player to pay the amount due while holding the times', () => {
    renderSummary()
    expect(screen.getByText(/We hold these times until the timer runs out\. Pay ₱910 using/)).toBeInTheDocument()
    expect(screen.queryByText(/Pay ₱900 /)).not.toBeInTheDocument()
  })

  it('uses the stored amount_due as the total, never re-adding the parts', () => {
    // A booking whose stored amounts carry centavos: the total is exactly what the server stored.
    renderSummary({ total_amount: 1500.5, booking_fee: 10, amount_due: 1510.5 })
    expect(amountFor('Court price')).toBe('₱1,500.50')
    expect(amountFor('Total')).toBe('₱1,510.50')
  })

  it('has no booking fee row for a booking without a fee (made at ₱0, walk-ins)', () => {
    renderSummary({ total_amount: 900, booking_fee: 0, amount_due: 900 })
    expect(amountFor('Court price')).toBe('₱900')
    expect(amountFor('Total')).toBe('₱900')
    expect(screen.queryByText('Booking fee')).not.toBeInTheDocument()
  })
})

describe('BookingPage: the manual proof amount is the amount due (T11.13)', () => {
  const settings = {
    timezone: 'Asia/Manila', currency: 'PHP', payment_instructions: 'Pay by GCash', cancel_cutoff_hours: 1, address: '123 Rizal Ave, Makati', maps_url: 'https://maps.app.goo.gl/AbC123',
  } as VenueSettings

  function renderPage(url: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={authState('anon')}>
          <MemoryRouter initialEntries={[url]}>
            <Routes>
              <Route path="/booking/:ref" element={<BookingPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )
  }

  beforeEach(() => {
    sessionStorage.clear()
    vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue(settings)
    vi.mocked(fetchPaymentAccounts).mockReset().mockResolvedValue([])
    const live = { ...booking, expires_at: new Date(Date.now() + 30 * 60_000).toISOString() }
    vi.mocked(fetchGuestBooking).mockReset().mockResolvedValue(live)
    vi.mocked(fetchOwnBooking).mockReset().mockResolvedValue(live)
  })

  it('prefills "Amount paid" with court price + fee, with no mismatch warning', async () => {
    renderPage(`/booking/${REF}#token=${TOKEN}`)
    const amount = await screen.findByLabelText('Amount paid')
    expect(amount).toHaveValue(910)
    expect(screen.queryByText(/This is different from the total/)).not.toBeInTheDocument()
  })
})
