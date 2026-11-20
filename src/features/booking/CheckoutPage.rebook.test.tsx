// T30.4: checkout reads `rebook` from the URL (the "Same time next week" link) and passes it to createBooking as
// rebookOfReference. Same setup as CheckoutPage.waiver.test.tsx: api.ts is mocked; hooks, React Query and the router are real.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import {
  fetchCourts, fetchPublicSchedule, fetchVenueSettings, type CourtWithPhotos, type PublicSchedulePeriod, type VenueSettings,
} from '../catalog/api'
import { fetchInfoSections } from '../venue/api'
import { createBooking, fetchAvailability, fetchPlatformFee, type Slot } from './api'
import { CheckoutPage } from './CheckoutPage'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourts: vi.fn(),
  fetchPublicSchedule: vi.fn(),
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
const allDay: PublicSchedulePeriod[] = [{ court_id: COURT, operating_date: '2030-01-07', period_start: '2030-01-06T22:00:00.000Z', period_end: '2030-01-07T16:00:00.000Z', booking_start: '2030-01-07', booking_end: '2030-02-06' }]

const slot = (start: string, end: string, price: number): Slot => ({
  court_id: COURT, slot_start: start, slot_end: end, price, status: 'free', booker_first_name: null, open_play_session_id: null, block_key: null,
})

// 10 PM and 11 PM in Manila (2 PM and 3 PM UTC).
const NIGHT = [
  slot('2030-01-07T14:00:00.000Z', '2030-01-07T15:00:00.000Z', 500),
  slot('2030-01-07T15:00:00.000Z', '2030-01-07T16:00:00.000Z', 500),
]

function renderCheckout(extra: Record<string, string> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const search = new URLSearchParams({ court: COURT, start: NIGHT[0].slot_start, slots: '2', ...extra }).toString()
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
  vi.mocked(fetchPublicSchedule).mockReset().mockResolvedValue(allDay)
  vi.mocked(fetchInfoSections).mockReset().mockResolvedValue([])
  vi.mocked(fetchAvailability).mockReset().mockResolvedValue(NIGHT)
  vi.mocked(fetchPlatformFee).mockReset().mockResolvedValue(10)
  vi.mocked(createBooking).mockReset().mockResolvedValue({ id: 'b1', referenceCode: 'CB-AAAAAA', guestToken: 'tok' })
})

async function reserve() {
  await userEvent.type(await screen.findByLabelText('Name'), 'Gina Guest')
  await userEvent.type(screen.getByLabelText('Email'), 'gina@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Reserve and continue to payment' }))
}

describe('CheckoutPage rebook (T30.4)', () => {
  it('passes rebook=<reference> from the URL to createBooking as rebookOfReference', async () => {
    renderCheckout({ rebook: 'CB-7KQ2XD' })
    await reserve()
    expect(createBooking).toHaveBeenCalledTimes(1)
    expect(createBooking).toHaveBeenCalledWith(expect.objectContaining({
      courtId: COURT, start: NIGHT[0].slot_start, slots: 2, rebookOfReference: 'CB-7KQ2XD',
    }))
  })

  it('trims the reference', async () => {
    renderCheckout({ rebook: ' CB-7KQ2XD ' })
    await reserve()
    expect(createBooking).toHaveBeenCalledWith(expect.objectContaining({ rebookOfReference: 'CB-7KQ2XD' }))
  })

  it('sends no rebookOfReference without a rebook parameter', async () => {
    renderCheckout()
    await reserve()
    expect(createBooking).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createBooking).mock.calls[0][0].rebookOfReference).toBeUndefined()
  })

  it('sends no rebookOfReference for a blank rebook parameter', async () => {
    renderCheckout({ rebook: '  ' })
    await reserve()
    expect(vi.mocked(createBooking).mock.calls[0][0].rebookOfReference).toBeUndefined()
  })
})
