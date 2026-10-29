import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Link } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bookingKeys } from '../booking/hooks'
import { adminKeys, subscribeToBookingChanges } from './api'
import type { BookingChange } from './bookingAlerts'
import { useBookingAlerts } from './useBookingAlerts'

vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), subscribeToBookingChanges: vi.fn() }))
vi.mock('../catalog/hooks', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useVenueSettings: () => ({ data: { name: 'Claudex Courts' } }),
}))

type Handlers = { onChange: (c: BookingChange) => void; onReconnect: () => void }
let handlers: Handlers
const unsubscribe = vi.fn()

const proof: BookingChange = { booking_id: 'b1', status: 'payment_submitted', old_status: 'pending_payment', source: 'online' }
const hold: BookingChange = { booking_id: 'b2', status: 'pending_payment', old_status: null, source: 'online' }

function Probe() {
  const { navCount } = useBookingAlerts()
  return (<><p data-testid="count">{navCount}</p><Link to="/admin/bookings">go bookings</Link><Link to="/admin">go dashboard</Link></>)
}

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

function setup(path = '/admin') {
  const client = new QueryClient()
  const spy = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}><Probe /></MemoryRouter>
    </QueryClientProvider>,
  )
  return { spy }
}

const count = () => screen.getByTestId('count').textContent

beforeEach(() => {
  document.title = 'Original title'
  unsubscribe.mockReset()
  vi.mocked(subscribeToBookingChanges).mockReset().mockImplementation((h: Handlers) => { handlers = h; return unsubscribe })
})
afterEach(() => setVisibility('visible'))

describe('useBookingAlerts', () => {
  it('subscribes once and unsubscribes on unmount', () => {
    const { unmount } = render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><Probe /></MemoryRouter></QueryClientProvider>)
    expect(subscribeToBookingChanges).toHaveBeenCalledTimes(1)
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('every event invalidates the admin and availability queries, even one that is not counted', () => {
    const { spy } = setup()
    act(() => handlers.onChange(hold))
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))
    for (const key of [adminKeys.allBookings, adminKeys.proofQueue, adminKeys.allEarnings, adminKeys.allMovedParts, bookingKeys.allAvailability]) {
      expect(keys).toContain(JSON.stringify(key))
    }
    expect(count()).toBe('0')
  })

  it('a reconnect invalidates the same queries and counts nothing', () => {
    const { spy } = setup()
    act(() => handlers.onReconnect())
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))
    expect(keys).toContain(JSON.stringify(adminKeys.allBookings))
    expect(keys).toContain(JSON.stringify(bookingKeys.allAvailability))
    expect(count()).toBe('0')
  })

  it('counts new bookings for the nav and clears the count on /admin/bookings', async () => {
    setup('/admin')
    act(() => handlers.onChange(proof))
    act(() => handlers.onChange({ ...proof, booking_id: 'b3' }))
    expect(count()).toBe('2')
    act(() => { screen.getByRole('link', { name: 'go bookings' }).click() })
    expect(count()).toBe('0')
  })

  it('does not count new bookings while the admin is already on /admin/bookings', () => {
    setup('/admin/bookings')
    act(() => handlers.onChange(proof))
    expect(count()).toBe('0')
  })

  it('does not touch the title while the tab is visible', () => {
    setup()
    act(() => handlers.onChange(proof))
    expect(document.title).toBe('Original title')
  })

  it('sets the title with the count while the tab is hidden and restores it when visible again', () => {
    setup()
    act(() => setVisibility('hidden'))
    act(() => handlers.onChange(proof))
    expect(document.title).toBe('(1) New bookings · Claudex Courts')
    act(() => handlers.onChange({ ...proof, booking_id: 'b3' }))
    expect(document.title).toBe('(2) New bookings · Claudex Courts')
    act(() => handlers.onChange(hold))
    expect(document.title).toBe('(2) New bookings · Claudex Courts')
    act(() => setVisibility('visible'))
    expect(document.title).toBe('Original title')
  })

  it('starts the title count again after the tab was seen', () => {
    setup()
    act(() => setVisibility('hidden'))
    act(() => handlers.onChange(proof))
    act(() => setVisibility('visible'))
    act(() => setVisibility('hidden'))
    act(() => handlers.onChange(proof))
    expect(document.title).toBe('(1) New bookings · Claudex Courts')
  })
})
