// BookingPage wiring for online payments (T7.5): the PayMongo return (token restore, ?paid moved out of the URL,
// polling, timeout), starting a checkout, and who gets the button. The api.ts functions are mocked; everything
// else (hooks, React Query, router, paymongoReturn, sessionStorage) is real.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import type { AuthState } from '../auth/AuthContext'
import { AuthContext } from '../auth/AuthContext'
import { fetchPaymentAccounts } from '../venue/api'
import { fetchVenueSettings, type VenueSettings } from '../catalog/api'
import { fetchGuestBooking, fetchOwnBooking, startPaymongoCheckout, type BookingDetail, type PaymentAttempt } from './api'
import { BookingPage } from './BookingPage'
import { goToCheckout, recallGuestToken, rememberGuestToken } from './paymongoReturn'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchGuestBooking: vi.fn(),
  fetchOwnBooking: vi.fn(),
  startPaymongoCheckout: vi.fn(),
}))
vi.mock('../catalog/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchVenueSettings: vi.fn() }))
vi.mock('../venue/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchPaymentAccounts: vi.fn() }))
// jsdom can't leave the page; the rest of paymongoReturn stays real.
vi.mock('./paymongoReturn', async (importOriginal) => ({ ...(await importOriginal<object>()), goToCheckout: vi.fn() }))

const REF = 'CB-7KQ2XD'
const TOKEN = 'secret-token'
const settings = {
  timezone: 'Asia/Manila', currency: 'PHP', payment_instructions: '**GCash**: 0917 000 0000', cancel_cutoff_hours: 1, address: '123 Rizal Ave, Makati', maps_url: 'https://maps.app.goo.gl/AbC123', online_payments_enabled: true,
} as VenueSettings

const paymongoPayment = (review_status: PaymentAttempt['review_status']): PaymentAttempt => ({
  id: 'pm1', method: 'paymongo', amount: 900, reference_number: null, submitted_at: new Date().toISOString(),
  review_status, reviewed_at: null, review_note: null,
})

function booking(overrides: Partial<BookingDetail> = {}): BookingDetail {
  return {
    id: 'b1', reference_code: REF, court_id: 'c1', court_name: 'Pickleball 2', sport: 'pickleball',
    slot_start: '2030-01-07T09:00:00.000Z', slot_end: '2030-01-07T10:00:00.000Z',
    status: 'pending_payment', total_amount: 900, booking_fee: 0, amount_due: 900, waiver_text: null, waiver_accepted_at: null, expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    rejection_count: 0, guest_name: 'Gina Guest', guest_email: 'gina@example.com', created_at: new Date().toISOString(),
    payments: [], cancelled_at: null, cancel_reason: null, cancelled_by_venue: false, user_id: null,
    parent_reference_code: null, continuations: [], changes: [],
    ...overrides,
  }
}

/** Shows where the router ended up, so tests can check the URL the page navigated to. */
function LocationProbe() {
  const location = useLocation()
  return <output aria-label="Current location">{location.pathname + location.search + location.hash}</output>
}

function renderPage(url: string, auth: AuthState = authState('anon')) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/booking/:ref" element={<><BookingPage /><LocationProbe /></>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

const location = () => screen.getByRole('status', { name: 'Current location' })
const payButton = () => screen.queryByRole('button', { name: 'Pay online with PayMongo' })

beforeEach(() => {
  sessionStorage.clear()
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue(settings)
  vi.mocked(fetchPaymentAccounts).mockReset().mockResolvedValue([])
  vi.mocked(fetchGuestBooking).mockReset().mockResolvedValue(booking())
  vi.mocked(fetchOwnBooking).mockReset().mockResolvedValue(booking())
  vi.mocked(startPaymongoCheckout).mockReset()
  vi.mocked(goToCheckout).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('BookingPage: back from PayMongo', () => {
  it("restores the guest's token from this tab and drops ?paid from the URL", async () => {
    rememberGuestToken(REF, TOKEN)
    renderPage(`/booking/${REF}?paid=1`)

    await waitFor(() => expect(location()).toHaveTextContent(`/booking/${REF}#token=${TOKEN}`))
    expect(location()).not.toHaveTextContent('paid=')
    expect(await screen.findByText(/Confirming your payment/)).toBeInTheDocument()
    expect(fetchGuestBooking).toHaveBeenCalledWith(REF, TOKEN)
    // No second online payment while the first one is being confirmed.
    expect(payButton()).not.toBeInTheDocument()
  })

  it('asks a guest to open their link when this tab has no saved token', async () => {
    renderPage(`/booking/${REF}?paid=1`)
    expect(await screen.findByText(/open the private link from your confirmation/)).toBeInTheDocument()
    expect(location()).toHaveTextContent(`/booking/${REF}`)
    expect(location()).not.toHaveTextContent('paid=')
    expect(fetchGuestBooking).not.toHaveBeenCalled()
  })

  it('polls until the webhook confirms the payment', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(fetchGuestBooking)
      .mockResolvedValueOnce(booking())
      .mockResolvedValue(booking({ status: 'confirmed', payments: [paymongoPayment('approved')] }))
    rememberGuestToken(REF, TOKEN)
    renderPage(`/booking/${REF}?paid=1`)

    expect(await screen.findByText(/Confirming your payment/)).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(await screen.findByText('Payment received. Your booking is confirmed.')).toBeInTheDocument()
    expect(screen.getByText('Paid online')).toBeInTheDocument()
  })

  it('says so after 90 seconds without confirmation, and keeps checking', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    rememberGuestToken(REF, TOKEN)
    renderPage(`/booking/${REF}?paid=1`)
    expect(await screen.findByText(/Confirming your payment/)).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(91_000))
    expect(await screen.findByText(/We haven't heard back from PayMongo yet/)).toBeInTheDocument()
    const callsAtTimeout = vi.mocked(fetchGuestBooking).mock.calls.length

    await act(() => vi.advanceTimersByTimeAsync(30_000))
    await waitFor(() => expect(vi.mocked(fetchGuestBooking).mock.calls.length).toBeGreaterThan(callsAtTimeout))
  })

  it('tells a player who cancelled on PayMongo that they can try again', async () => {
    rememberGuestToken(REF, TOKEN)
    renderPage(`/booking/${REF}?paid=0`)

    expect(await screen.findByText(/Online payment was cancelled/)).toBeInTheDocument()
    expect(location()).toHaveTextContent(`/booking/${REF}#token=${TOKEN}`)
    expect(payButton()).toBeEnabled()
  })

  it('shows a refund note when the payment arrived but was not accepted', async () => {
    vi.mocked(fetchGuestBooking).mockResolvedValue(booking({ status: 'cancelled', payments: [paymongoPayment('rejected')] }))
    rememberGuestToken(REF, TOKEN)
    renderPage(`/booking/${REF}?paid=1`)
    expect(await screen.findByText(/couldn't apply it to this booking/)).toBeInTheDocument()
  })
})

describe('BookingPage: starting an online payment', () => {
  it("saves the guest's token for the way back, then leaves for PayMongo", async () => {
    vi.mocked(startPaymongoCheckout).mockResolvedValue('https://checkout.paymongo.test/stub/cs_stub_1')
    renderPage(`/booking/${REF}#token=${TOKEN}`)

    await userEvent.click(await screen.findByRole('button', { name: 'Pay online with PayMongo' }))
    await waitFor(() => expect(goToCheckout).toHaveBeenCalledWith('https://checkout.paymongo.test/stub/cs_stub_1'))
    expect(startPaymongoCheckout).toHaveBeenCalledWith({ referenceCode: REF, token: TOKEN })
    expect(recallGuestToken(REF)).toBe(TOKEN)
    // Stays busy while the browser is on its way to PayMongo.
    expect(screen.getByRole('button', { name: 'Taking you to PayMongo…' })).toBeDisabled()
    expect(screen.getByText(/Taking you to PayMongo… This can take a few seconds/)).toBeInTheDocument()
  })

  it('shows a readable error when the checkout cannot start', async () => {
    const { ApiError } = await import('../../lib/queryClient')
    vi.mocked(startPaymongoCheckout).mockRejectedValue(
      new ApiError("Online payment isn't available right now. Please upload a proof instead.", '503', 'payments_unavailable'),
    )
    renderPage(`/booking/${REF}#token=${TOKEN}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Pay online with PayMongo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Online payment isn't available right now")
    expect(goToCheckout).not.toHaveBeenCalled()
    // Usable again: the player can retry or upload a proof instead.
    expect(screen.getByRole('button', { name: 'Pay online with PayMongo' })).toBeEnabled()
  })

  it('shows no return message on a normal visit', async () => {
    renderPage(`/booking/${REF}#token=${TOKEN}`)
    expect(await screen.findByRole('button', { name: 'Pay online with PayMongo' })).toBeEnabled()
    expect(screen.queryByText(/Confirming your payment|Online payment was cancelled/)).not.toBeInTheDocument()
  })

  it('offers the owner the button with their session alone', async () => {
    renderPage(`/booking/${REF}`, authState('player'))
    expect(await screen.findByRole('button', { name: 'Pay online with PayMongo' })).toBeEnabled()
    expect(fetchOwnBooking).toHaveBeenCalledWith(REF)
  })

  it('offers an admin the button on their own booking', async () => {
    vi.mocked(fetchOwnBooking).mockResolvedValue(booking({ user_id: 'admin-id' }))
    renderPage(`/booking/${REF}`, authState('admin'))
    expect(await screen.findByRole('button', { name: 'Pay online with PayMongo' })).toBeEnabled()
  })

  it("gives staff viewing someone else's booking without its link no Pay online button", async () => {
    vi.mocked(fetchOwnBooking).mockResolvedValue(booking({ user_id: 'player-id' }))
    renderPage(`/booking/${REF}`, authState('admin'))
    expect(await screen.findByText('Pickleball 2')).toBeInTheDocument()
    expect(payButton()).not.toBeInTheDocument()
  })
})

describe('BookingPage: where to play', () => {
  it("shows the venue's address, linked to its Google Maps page", async () => {
    renderPage(`/booking/${REF}#token=${TOKEN}`)
    const where = await screen.findByRole('region', { name: 'Location' })
    expect(within(where).getByRole('link', { name: /123 Rizal Ave, Makati/ })).toHaveAttribute('href', 'https://maps.app.goo.gl/AbC123')
  })

  it('lists the payment accounts in the pay section, above the instructions', async () => {
    vi.mocked(fetchPaymentAccounts).mockResolvedValue([
      { id: 'a1', label: 'GCash', account_name: 'Claudex Courts', account_number: '0917 000 0000', qr_path: null, position: 0 },
    ])
    renderPage(`/booking/${REF}#token=${TOKEN}`)
    const pay = await screen.findByRole('region', { name: /Pay within/ })
    const accounts = await within(pay).findByRole('list', { name: 'Payment accounts' })
    expect(within(accounts).getByText('0917 000 0000')).toBeInTheDocument()
    expect(accounts.nextElementSibling).toHaveClass('instructions')
  })
})

// T11.23: Plotline's online payments switch (venue_settings.online_payments_enabled).
describe('BookingPage: online payments switch', () => {
  it('on: shows the Pay online and Or pay manually headings and the PayMongo button', async () => {
    renderPage(`/booking/${REF}#token=${TOKEN}`)
    expect(await screen.findByRole('button', { name: 'Pay online with PayMongo' })).toBeEnabled()
    expect(screen.getByRole('heading', { name: 'Pay online' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Or pay manually' })).toBeInTheDocument()
  })

  it('off: no PayMongo button and no Pay online heading, but the manual instructions, accounts and proof upload stay', async () => {
    vi.mocked(fetchVenueSettings).mockResolvedValue({ ...settings, online_payments_enabled: false })
    vi.mocked(fetchPaymentAccounts).mockResolvedValue([
      { id: 'a1', label: 'GCash', account_name: 'Claudex Courts', account_number: '0917 111 2222', qr_path: null, position: 0 },
    ])
    renderPage(`/booking/${REF}#token=${TOKEN}`)
    expect(await screen.findByText('GCash', { selector: 'strong' })).toBeInTheDocument()
    expect(payButton()).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Pay online' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Or pay manually' })).not.toBeInTheDocument()
    expect(await screen.findByText('0917 111 2222')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit proof of payment' })).toBeInTheDocument()
  })
})
