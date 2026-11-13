// T27.3: the booking page's status steps, payment-first order and per-status copy. Same rendering setup as
// BookingPage.test.tsx: api.ts reads, venue settings and payment accounts are mocked; the rest is real.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import { fetchVenueSettings, type VenueSettings } from '../catalog/api'
import { formatDateTimeInZone } from '../../lib/time'
import { fetchPaymentAccounts } from '../venue/api'
import { fetchGuestBooking, fetchOwnBooking, type BookingDetail, type PaymentAttempt } from './api'
import { BookingPage } from './BookingPage'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchGuestBooking: vi.fn(),
  fetchOwnBooking: vi.fn(),
}))
vi.mock('../catalog/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchVenueSettings: vi.fn() }))
vi.mock('../venue/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchPaymentAccounts: vi.fn() }))

const REF = 'CB-7KQ2XD'
const TOKEN = 'secret-token'
const TZ = 'Asia/Manila'
const settings = {
  timezone: TZ, currency: 'PHP', payment_instructions: '**GCash**: 0917 000 0000', cancel_cutoff_hours: 1,
  address: '123 Rizal Ave, Makati', maps_url: 'https://maps.app.goo.gl/AbC123', online_payments_enabled: true,
} as VenueSettings

const proof = (overrides: Partial<PaymentAttempt> = {}): PaymentAttempt => ({
  id: 'p1', method: 'gcash', amount: 900, reference_number: '123456', submitted_at: '2030-01-06T23:30:00.000Z', // 7:30 AM Manila, Jan 7
  review_status: 'pending', reviewed_at: null, review_note: null, ...overrides,
})

function booking(overrides: Partial<BookingDetail> = {}): BookingDetail {
  return {
    id: 'b1', reference_code: REF, court_id: 'c1', court_name: 'Pickleball 2', sport: 'pickleball',
    slot_start: '2030-01-07T09:00:00.000Z', slot_end: '2030-01-07T10:00:00.000Z',
    status: 'pending_payment', total_amount: 900, booking_fee: 0, amount_due: 900, waiver_text: null, waiver_accepted_at: null,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    rejection_count: 0, guest_name: 'Gina Guest', guest_email: 'gina@example.com', created_at: new Date().toISOString(),
    payments: [], cancelled_at: null, cancel_reason: null, cancelled_by_venue: false, user_id: null,
    parent_reference_code: null, continuations: [], changes: [],
    ...overrides,
  }
}

function renderPage(b: BookingDetail, state: object | null = null) {
  vi.mocked(fetchGuestBooking).mockResolvedValue(b)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={authState('anon')}>
        <MemoryRouter initialEntries={[{ pathname: `/booking/${REF}`, hash: `#token=${TOKEN}`, state }]}>
          <Routes><Route path="/booking/:ref" element={<BookingPage />} /></Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

/** True when `a` comes before `b` in the document. */
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
const steps = () => screen.queryByRole('list', { name: 'Booking progress' })
const stepItems = () => within(screen.getByRole('list', { name: 'Booking progress' })).getAllByRole('listitem')
const currentOf = (list: HTMLElement[]) => list.filter((li) => li.getAttribute('aria-current') === 'step')

beforeEach(() => {
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue(settings)
  vi.mocked(fetchPaymentAccounts).mockReset().mockResolvedValue([])
  vi.mocked(fetchGuestBooking).mockReset()
  vi.mocked(fetchOwnBooking).mockReset()
})

describe('BookingPage: status steps', () => {
  it.each([
    ['pending_payment', {}, 'Reserved'],
    ['payment_submitted', { status: 'payment_submitted', expires_at: null, payments: [proof()] }, 'Payment sent'],
    ['confirmed', { status: 'confirmed', expires_at: null, payments: [proof({ review_status: 'approved' })] }, 'Confirmed'],
    ['completed', {
      status: 'confirmed', expires_at: null, slot_start: '2020-01-07T09:00:00.000Z', slot_end: '2020-01-07T10:00:00.000Z',
      payments: [proof({ review_status: 'approved' })],
    }, 'Confirmed'],
  ] as const)('%s shows the three steps', async (_status, overrides, current) => {
    renderPage(booking(overrides as Partial<BookingDetail>))
    await screen.findByRole('list', { name: 'Booking progress' })
    const items = stepItems()
    expect(items).toHaveLength(3)
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Reserved'), expect.stringContaining('Payment sent'), expect.stringContaining('Confirmed'),
    ])
    const marked = currentOf(items)
    expect(marked).toHaveLength(1)
    expect(marked[0]).toHaveTextContent(current)
    // Not color alone: the current step says so in text, and the others don't.
    expect(marked[0]).toHaveTextContent(/current/i)
    for (const li of items.filter((i) => i !== marked[0])) expect(li).not.toHaveTextContent(/current/i)
  })

  it.each([
    ['expired', { expires_at: new Date(Date.now() - 60_000).toISOString() }, /expired before payment/],
    ['rejected', { status: 'rejected', expires_at: null, payments: [proof({ review_status: 'rejected' })] }, /couldn't verify your payment/],
    ['cancelled', { status: 'cancelled', expires_at: null, cancel_reason: 'Rain' }, /This booking was cancelled/],
  ] as const)('%s has no progress line and keeps its alert', async (_status, overrides, alert) => {
    renderPage(booking(overrides as Partial<BookingDetail>))
    expect(await screen.findByText(alert)).toBeInTheDocument()
    expect(steps()).not.toBeInTheDocument()
  })
})

describe('BookingPage: pending payment comes first', () => {
  it.each([['not just booked', null], ['just booked', { justBooked: true }]])(
    'orders the booking facts, the pay section, then the save-link notice (%s)', async (_label, state) => {
      renderPage(booking(), state)
      const pay = await screen.findByRole('heading', { name: /Pay within/ })
      const save = await screen.findByRole('heading', { name: 'Save this link' })
      const total = screen.getByText('Total', { selector: 'dt' })
      expect(before(total, pay)).toBe(true)
      expect(before(pay, save)).toBe(true)
      // Still reachable by its field, and the total sits before the payment section too.
      expect((screen.getByLabelText('Private booking link') as HTMLInputElement).value).toContain('#token=')
    })

  it('does not push the save-link card to the top when just booked', async () => {
    renderPage(booking(), { justBooked: true })
    const save = await screen.findByRole('heading', { name: 'Save this link' })
    expect(save.closest('section')).not.toHaveClass('card-highlight')
    expect(screen.getByRole('heading', { name: 'Booking reserved' })).toBeInTheDocument()
  })
})

describe('BookingPage: payment submitted', () => {
  const submitted = (payments: PaymentAttempt[]) => booking({ status: 'payment_submitted', expires_at: null, payments })

  it("replaces the old 'checking your payment' text with the proof's received time in the venue timezone", async () => {
    renderPage(submitted([proof()]))
    expect(await screen.findByText(/The venue checks payments by hand\. We'll email you when it's confirmed\./)).toBeInTheDocument()
    expect(screen.queryByText(/Thanks! We're checking your payment/)).not.toBeInTheDocument()
    const label = screen.getByText(/Proof received/)
    const received = formatDateTimeInZone('2030-01-06T23:30:00.000Z', TZ)
    expect(received).toMatch(/7:30/) // early morning in Manila is the previous day in UTC
    expect(label.closest('div, p, li, section')).toHaveTextContent(received)
  })

  it('shows the latest proof when several were sent, and promises no review time', async () => {
    renderPage(submitted([
      proof({ id: 'p0', review_status: 'rejected', submitted_at: '2030-01-05T14:15:00.000Z' }),
      proof({ id: 'p1', submitted_at: '2030-01-06T16:45:00.000Z' }), // 12:45 AM Manila, Jan 7 (late night)
    ]))
    await screen.findByText(/Proof received/)
    const newest = formatDateTimeInZone('2030-01-06T16:45:00.000Z', TZ)
    expect(screen.getByText(/Proof received/).closest('div, p, li, section')).toHaveTextContent(newest)
    const block = screen.getByText(/Proof received/).closest('div, p, li, section')!
    expect(block).not.toHaveTextContent(formatDateTimeInZone('2030-01-05T14:15:00.000Z', TZ))
    // No promised review duration in the status message.
    const message = screen.getByText(/The venue checks payments by hand/).closest('div, section')!
    expect(message).not.toHaveTextContent(/minutes?|hours?|days?/i)
  })
})

describe('BookingPage: confirmed', () => {
  it('shows the court card and the venue address before the payment history', async () => {
    renderPage(booking({ status: 'confirmed', expires_at: null, payments: [proof({ review_status: 'approved' })] }))
    const court = await screen.findByRole('heading', { name: 'Pickleball 2' })
    const location = await screen.findByRole('heading', { name: 'Location' })
    const history = await screen.findByRole('heading', { name: 'Payments' })
    expect(screen.getByText(/123 Rizal Ave, Makati/)).toBeInTheDocument()
    expect(before(court, location)).toBe(true)
    expect(before(location, history)).toBe(true)
  })
})
