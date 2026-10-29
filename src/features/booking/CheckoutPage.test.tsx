// T11.13: checkout shows the court price (the server's slot prices), Plotline's booking fee (platform_pricing,
// through usePlatformFee) and the total, all from the server. The api.ts functions are mocked; hooks, React Query
// and the router are real.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import {
  fetchCourts, fetchOperatingHours, fetchVenueSettings, type CourtWithPhotos, type OperatingHours, type VenueSettings,
} from '../catalog/api'
import { fetchInfoSections } from '../venue/api'
import { fetchAvailability, fetchPlatformFee, type Slot } from './api'
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

/** The value shown next to a label in the booking facts (the label and its value share a row). */
async function amountFor(label: string) {
  const term = await screen.findByText(label, { exact: true })
  return term.parentElement?.textContent?.replace(label, '').trim()
}

beforeEach(() => {
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue(settings)
  vi.mocked(fetchCourts).mockReset().mockResolvedValue([court as unknown as CourtWithPhotos])
  vi.mocked(fetchOperatingHours).mockReset().mockResolvedValue(allDay)
  vi.mocked(fetchInfoSections).mockReset().mockResolvedValue([])
  vi.mocked(fetchAvailability).mockReset().mockResolvedValue([...MORNING, ...NIGHT])
  vi.mocked(fetchPlatformFee).mockReset().mockResolvedValue(10)
})

describe('CheckoutPage: court price, booking fee and total (T11.13)', () => {
  it('shows the court price as the sum of the server slot prices, the booking fee and the total (early morning)', async () => {
    renderCheckout(MORNING[0].slot_start, 2)
    expect(await amountFor('Court price')).toBe('₱750')
    expect(await amountFor('Booking fee')).toBe('₱10')
    expect(await amountFor('Total')).toBe('₱760')
    expect(fetchPlatformFee).toHaveBeenCalled()
  })

  it('adds a fee with centavos to a late-night run', async () => {
    vi.mocked(fetchPlatformFee).mockResolvedValue(10.5)
    renderCheckout(NIGHT[0].slot_start, 2)
    expect(await amountFor('Court price')).toBe('₱1,000')
    expect(await amountFor('Booking fee')).toBe('₱10.50')
    expect(await amountFor('Total')).toBe('₱1,010.50')
  })

  it('has no booking fee row when the fee is 0, and the total is the court price', async () => {
    vi.mocked(fetchPlatformFee).mockResolvedValue(0)
    renderCheckout(MORNING[0].slot_start, 1)
    expect(await amountFor('Total')).toBe('₱350')
    expect(await amountFor('Court price')).toBe('₱350')
    expect(screen.queryByText('Booking fee')).not.toBeInTheDocument()
  })

  it('never shows a total without the fee while the fee cannot be loaded', async () => {
    vi.mocked(fetchPlatformFee).mockRejectedValue(new Error('Network down'))
    renderCheckout(MORNING[0].slot_start, 2)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Total')).not.toBeInTheDocument()
  })
})
