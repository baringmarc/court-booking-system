// T11.20 (waiver at checkout, page level). Based on the T11.13 setup: checkout shows the court price (the server's slot prices), Plotline's booking fee (platform_pricing,
// through usePlatformFee) and the total, all from the server. The api.ts functions are mocked; hooks, React Query
// and the router are real.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import {
  fetchCourts, fetchOperatingHours, fetchVenueSettings, type CourtWithPhotos, type OperatingHours, type VenueSettings,
} from '../catalog/api'
import { fetchInfoSections } from '../venue/api'
import { createBooking, fetchAvailability, fetchPlatformFee, type Slot } from './api'
import { CheckoutPage } from './CheckoutPage'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourts: vi.fn(),
  fetchOperatingHours: vi.fn(),
  fetchVenueSettings: vi.fn(),
}))
vi.mock('../venue/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchInfoSections: vi.fn() }))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchAvailability: vi.fn(),
  fetchPlatformFee: vi.fn(),
  createBooking: vi.fn(),
}))

const COURT = '0c0c0c0c-0000-4000-8000-000000000001'
const court = { id: COURT, name: 'Pickleball 1', sport: 'pickleball', description: null, is_active: true, court_photos: [] }
const settings = { timezone: 'Asia/Manila', currency: 'PHP', payment_hold_minutes: 30, booking_window_days: 30 } as VenueSettings
const allDay = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '06:00:00', close_time: '24:00:00', is_closed: false })) as OperatingHours[]

const slot = (start: string, end: string, price: number): Slot => ({
  court_id: COURT, slot_start: start, slot_end: end, price, status: 'free', booker_first_name: null, open_play_session_id: null, block_key: null,
})

// 7 AM and 8 AM in Manila are 11 PM and midnight UTC the day before; the two hours are priced differently.
const MORNING = [
  slot('2030-01-06T23:00:00.000Z', '2030-01-07T00:00:00.000Z', 350),
  slot('2030-01-07T00:00:00.000Z', '2030-01-07T01:00:00.000Z', 400),
]
// 10 PM and 11 PM in Manila (2 PM and 3 PM UTC).
const NIGHT = [
  slot('2030-01-07T14:00:00.000Z', '2030-01-07T15:00:00.000Z', 500),
  slot('2030-01-07T15:00:00.000Z', '2030-01-07T16:00:00.000Z', 500),
]

function renderCheckout(start: string, slots: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const search = new URLSearchParams({ court: COURT, start, slots: String(slots) }).toString()
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={authState('anon')}>
        <MemoryRouter initialEntries={[`/book/checkout?${search}`]}>
          <Routes>
            <Route path="/book/checkout" element={<CheckoutPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}


beforeEach(() => {
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue(settings)
  vi.mocked(fetchCourts).mockReset().mockResolvedValue([court as unknown as CourtWithPhotos])
  vi.mocked(fetchOperatingHours).mockReset().mockResolvedValue(allDay)
  vi.mocked(fetchInfoSections).mockReset().mockResolvedValue([])
  vi.mocked(fetchAvailability).mockReset().mockResolvedValue([...MORNING, ...NIGHT])
  vi.mocked(fetchPlatformFee).mockReset().mockResolvedValue(10)
})

const WAIVER = 'You play at your own risk.'
const settingsWith = (waiver_text: string) => ({ ...settings, waiver_text }) as VenueSettings

async function fillAndConfirm(tick: boolean) {
  await userEvent.type(await screen.findByLabelText('Name'), 'Gina Guest')
  await userEvent.type(screen.getByLabelText('Email'), 'gina@example.com')
  if (tick) await userEvent.click(screen.getByRole('checkbox', { name: 'I have read and accept the waiver' }))
  await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }))
}

describe('CheckoutPage waiver (T11.20)', () => {
  it('shows the venue waiver text and sends waiverAccepted true when ticked', async () => {
    vi.mocked(fetchVenueSettings).mockResolvedValue(settingsWith(WAIVER))
    vi.mocked(createBooking).mockReset().mockResolvedValue({ id: 'b1', referenceCode: 'CB-AAAAAA', guestToken: 'tok' })
    renderCheckout(NIGHT[0].slot_start, 2)
    expect(await screen.findByText(WAIVER)).toBeInTheDocument()
    await fillAndConfirm(true)
    expect(createBooking).toHaveBeenCalledWith(expect.objectContaining({ waiverAccepted: true }))
  })

  it('does not create the booking when the box is unticked', async () => {
    vi.mocked(fetchVenueSettings).mockResolvedValue(settingsWith(WAIVER))
    vi.mocked(createBooking).mockReset()
    renderCheckout(NIGHT[0].slot_start, 2)
    await fillAndConfirm(false)
    expect(await screen.findByText('Tick the box to accept the waiver.')).toBeInTheDocument()
    expect(createBooking).not.toHaveBeenCalled()
  })

  it('shows no waiver and sends waiverAccepted false when the venue has none', async () => {
    vi.mocked(fetchVenueSettings).mockResolvedValue(settingsWith(''))
    vi.mocked(createBooking).mockReset().mockResolvedValue({ id: 'b1', referenceCode: 'CB-AAAAAA', guestToken: 'tok' })
    renderCheckout(NIGHT[0].slot_start, 2)
    await fillAndConfirm(false)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(createBooking).toHaveBeenCalledWith(expect.objectContaining({ waiverAccepted: false }))
  })
})
