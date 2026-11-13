// T27.4: one payment path on the booking page. Choosing an account card sets "Paid with"; changing the select by hand
// moves the chosen card; a single account is chosen from the start. Same setup as BookingPage.status.test.tsx.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import { fetchVenueSettings, type VenueSettings } from '../catalog/api'
import { fetchPaymentAccounts, type PaymentAccount } from '../venue/api'
import { fetchGuestBooking, fetchOwnBooking, type BookingDetail } from './api'
import { BookingPage } from './BookingPage'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchGuestBooking: vi.fn(),
  fetchOwnBooking: vi.fn(),
}))
vi.mock('../catalog/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchVenueSettings: vi.fn() }))
vi.mock('../venue/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchPaymentAccounts: vi.fn(),
  qrImageUrl: (path: string) => `https://cdn.test/qr/${path}`,
  qrDownloadUrl: (path: string, label: string) => `https://cdn.test/qr/${path}?download=${label}`,
}))

const REF = 'CB-7KQ2XD'
const settings = {
  timezone: 'Asia/Manila', currency: 'PHP', payment_instructions: '', cancel_cutoff_hours: 1,
  address: '123 Rizal Ave, Makati', maps_url: 'https://maps.app.goo.gl/AbC123', online_payments_enabled: true,
} as VenueSettings
const gcash: PaymentAccount = { id: 'a1', label: 'GCash', account_name: 'Claudex Courts', account_number: '0917 000 0000', qr_path: 'q1.png', position: 0 }
const bank: PaymentAccount = { id: 'a2', label: 'BPI', account_name: 'Claudex Bank Name', account_number: '1234-5678-90', qr_path: null, position: 1 }

const booking: BookingDetail = {
  id: 'b1', reference_code: REF, court_id: 'c1', court_name: 'Pickleball 2', sport: 'pickleball',
  slot_start: '2030-01-07T09:00:00.000Z', slot_end: '2030-01-07T10:00:00.000Z',
  status: 'pending_payment', total_amount: 900, booking_fee: 0, amount_due: 900, waiver_text: null, waiver_accepted_at: null,
  expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  rejection_count: 0, guest_name: 'Gina Guest', guest_email: 'gina@example.com', created_at: new Date().toISOString(),
  payments: [], cancelled_at: null, cancel_reason: null, cancelled_by_venue: false, user_id: null,
  parent_reference_code: null, continuations: [], changes: [],
}

function renderPage() {
  vi.mocked(fetchGuestBooking).mockResolvedValue(booking)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={authState('anon')}>
        <MemoryRouter initialEntries={[{ pathname: `/booking/${REF}`, hash: '#token=secret-token' }]}>
          <Routes><Route path="/booking/:ref" element={<BookingPage />} /></Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}
const card = (name: string) => screen.getByRole('article', { name })

beforeEach(() => {
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue(settings)
  vi.mocked(fetchPaymentAccounts).mockReset().mockResolvedValue([gcash, bank])
  vi.mocked(fetchGuestBooking).mockReset()
  vi.mocked(fetchOwnBooking).mockReset()
})

describe('BookingPage: one payment path (T27.4)', () => {
  it('with 2 accounts, starts with nothing chosen: labels and buttons only, "Paid with" on Choose…', async () => {
    renderPage()
    await screen.findByRole('list', { name: 'Payment accounts' })
    const select = await screen.findByLabelText('Paid with')
    expect(select).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Pay with GCash' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay with BPI' })).toBeInTheDocument()
    expect(screen.queryByText('0917 000 0000')).not.toBeInTheDocument()
    expect(screen.queryByText('1234-5678-90')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'QR code for GCash' })).not.toBeInTheDocument()
  })

  it('choosing a card sets "Paid with" and reveals only that card\'s details', async () => {
    renderPage()
    await screen.findByRole('list', { name: 'Payment accounts' })
    const select = await screen.findByLabelText('Paid with')
    await userEvent.click(screen.getByRole('button', { name: 'Pay with GCash' }))
    expect(select).toHaveValue('account:a1')
    expect(within(card('GCash')).getByText('0917 000 0000')).toBeInTheDocument()
    expect(within(card('GCash')).getByRole('img', { name: 'QR code for GCash' })).toBeInTheDocument()
    expect(within(card('GCash')).getByRole('button', { pressed: true })).toHaveTextContent('Selected')
    expect(within(card('BPI')).queryByText('1234-5678-90')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay with BPI' })).toBeInTheDocument()
  })

  it('choosing another card moves the select and the details to it', async () => {
    renderPage()
    await screen.findByRole('list', { name: 'Payment accounts' })
    const select = await screen.findByLabelText('Paid with')
    await userEvent.click(screen.getByRole('button', { name: 'Pay with GCash' }))
    await userEvent.click(screen.getByRole('button', { name: 'Pay with BPI' }))
    expect(select).toHaveValue('account:a2')
    expect(within(card('BPI')).getByText('1234-5678-90')).toBeInTheDocument()
    expect(within(card('GCash')).queryByText('0917 000 0000')).not.toBeInTheDocument()
    expect(within(card('GCash')).getByRole('button', { name: 'Pay with GCash' })).toBeInTheDocument()
  })

  it('changing the select by hand still works and the chosen card follows it', async () => {
    renderPage()
    await screen.findByRole('list', { name: 'Payment accounts' })
    const select = await screen.findByLabelText('Paid with')
    await userEvent.click(screen.getByRole('button', { name: 'Pay with GCash' }))
    await userEvent.selectOptions(select, 'BPI')
    expect(select).toHaveValue('account:a2')
    expect(within(card('BPI')).getByText('1234-5678-90')).toBeInTheDocument()
    expect(within(card('BPI')).getByRole('button', { pressed: true })).toHaveTextContent('Selected')
    expect(within(card('GCash')).queryByText('0917 000 0000')).not.toBeInTheDocument()
  })

  it('picking an account in the select first also reveals its card', async () => {
    renderPage()
    await screen.findByRole('list', { name: 'Payment accounts' })
    await userEvent.selectOptions(await screen.findByLabelText('Paid with'), 'GCash')
    expect(within(card('GCash')).getByText('0917 000 0000')).toBeInTheDocument()
    expect(within(card('BPI')).queryByText('1234-5678-90')).not.toBeInTheDocument()
  })

  it('with one account, it is chosen from the start: details shown, select preselected, button reads Selected', async () => {
    vi.mocked(fetchPaymentAccounts).mockResolvedValue([gcash])
    renderPage()
    await screen.findByRole('list', { name: 'Payment accounts' })
    const select = await screen.findByLabelText('Paid with')
    expect(select).toHaveValue('account:a1')
    expect(within(card('GCash')).getByText('0917 000 0000')).toBeInTheDocument()
    expect(within(card('GCash')).getByRole('img', { name: 'QR code for GCash' })).toBeInTheDocument()
    expect(within(card('GCash')).getByRole('button', { pressed: true })).toHaveTextContent('Selected')
  })

  it('with no accounts, shows no list and preselects nothing', async () => {
    vi.mocked(fetchPaymentAccounts).mockResolvedValue([])
    renderPage()
    const select = await screen.findByLabelText('Paid with')
    expect(select).toHaveValue('')
    expect(screen.queryByRole('list', { name: 'Payment accounts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Pay with / })).not.toBeInTheDocument()
  })
})
