import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import { VenueContext } from '../venue/VenueContext'
import { subscribeToBookingChanges } from './api'
import type { BookingChange } from './bookingAlerts'
import { AdminLayout } from './AdminLayout'

vi.mock('../auth/api', () => ({ fetchMemberVenues: vi.fn().mockResolvedValue([]) }))
vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), subscribeToBookingChanges: vi.fn() }))
vi.mock('../catalog/hooks', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useVenueSettings: () => ({ data: { name: 'Claudex Courts' } }),
}))

let onChange: (c: BookingChange) => void
const proof: BookingChange = { booking_id: 'b1', status: 'payment_submitted', old_status: 'pending_payment', source: 'online' }

beforeEach(() => {
  vi.mocked(subscribeToBookingChanges).mockReset().mockImplementation((h: { onChange: (c: BookingChange) => void }) => { onChange = h.onChange; return () => {} })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <VenueContext.Provider value={{ id: '00000000-0000-4000-8000-0000000000a1', slug: 'claudex-courts', status: 'active' }}><AuthContext.Provider value={authState('admin', { venueIds: ['00000000-0000-4000-8000-0000000000a1'] })}>
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<h1>Dashboard</h1>} />
              <Route path="bookings" element={<h1>Bookings page</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider></VenueContext.Provider>
    </QueryClientProvider>,
  )
})

describe('AdminLayout new-booking badge', () => {
  it('has no count in the Bookings link when nothing is new', () => {
    expect(screen.getByRole('link', { name: 'Bookings' })).toBeInTheDocument()
  })

  it('names the link "Bookings, N new" when new bookings arrive, and has no live region', () => {
    act(() => onChange(proof))
    expect(screen.getByRole('link', { name: 'Bookings, 1 new' })).toBeInTheDocument()
    act(() => onChange({ ...proof, booking_id: 'b2' }))
    expect(screen.getByRole('link', { name: 'Bookings, 2 new' })).toBeInTheDocument()
    expect(document.querySelector('[aria-live]')).toBeNull()
  })

  it('clears the count when the admin opens Bookings', async () => {
    act(() => onChange(proof))
    await userEvent.click(screen.getByRole('link', { name: 'Bookings, 1 new' }))
    expect(await screen.findByRole('heading', { name: 'Bookings page' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Bookings' })).toBeInTheDocument()
  })
})
