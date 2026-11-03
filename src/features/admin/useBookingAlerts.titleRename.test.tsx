import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'
import { subscribeToBookingChanges } from './api'
import type { BookingChange } from './bookingAlerts'
import { useBookingAlerts } from './useBookingAlerts'

let venueName = 'Forty Degrees'
vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), subscribeToBookingChanges: vi.fn() }))
vi.mock('../catalog/hooks', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useVenueSettings: () => ({ data: { name: venueName } }),
}))

function Probe() {
  useBookingAlerts()
  return null
}

beforeEach(() => {
  venueName = 'Forty Degrees'
  document.title = venueName
  setCurrentVenue({ id: 'venue-a', slug: 'forty-degrees', status: 'active' })
})

it('restores the latest venue name after a hidden alert and a rename', () => {
  let onChange: ((change: BookingChange) => void) | undefined
  vi.mocked(subscribeToBookingChanges).mockImplementation((handlers) => {
    onChange = handlers.onChange
    return () => {}
  })
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter><Probe /></MemoryRouter>
    </QueryClientProvider>
  )
  const client = new QueryClient()
  const view = render(tree())
  const visibility = (state: 'hidden' | 'visible') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  act(() => visibility('hidden'))
  act(() => onChange?.({ booking_id: 'b1', status: 'payment_submitted', old_status: 'pending_payment', source: 'online' }))
  expect(document.title).toBe('(1) New bookings · Forty Degrees')

  venueName = 'Forty Degrees Sports'
  view.rerender(tree())
  expect(document.title).toBe('(1) New bookings · Forty Degrees Sports')

  act(() => visibility('visible'))
  expect(document.title).toBe('Forty Degrees Sports')
  view.unmount()
})
