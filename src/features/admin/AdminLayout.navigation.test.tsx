import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import { fetchMemberVenues } from '../auth/api'
import { VenueContext } from '../venue/VenueContext'
import { AdminLayout } from './AdminLayout'
import { subscribeToBookingChanges } from './api'
import type { BookingChange } from './bookingAlerts'

vi.mock('../auth/api', () => ({ fetchMemberVenues: vi.fn().mockResolvedValue([]) }))
vi.mock('./api', async (original) => ({ ...(await original<object>()), subscribeToBookingChanges: vi.fn() }))
vi.mock('../catalog/hooks', async (original) => ({ ...(await original<object>()), useVenueSettings: () => ({ data: { name: 'Test Venue' } }) }))

const venue = { id: 'venue-a', slug: 'a-venue', status: 'active' as const }
let onChange: (change: BookingChange) => void
beforeEach(() => {
  setCurrentVenue(venue)
  vi.mocked(fetchMemberVenues).mockReset().mockResolvedValue([])
  vi.mocked(subscribeToBookingChanges).mockReset().mockImplementation((handlers) => {
    onChange = handlers.onChange
    return () => {}
  })
})

function mount(auth = authState('admin')) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <VenueContext.Provider value={venue}><AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/admin']}><Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<h1>Dashboard page</h1>} />
          <Route path="bookings" element={<h1>Bookings page</h1>} />
          <Route path="reports" element={<h1>Reports page</h1>} />
        </Route>
        <Route path="/admin/login" element={<h1>Login page</h1>} />
      </Routes></MemoryRouter>
    </AuthContext.Provider></VenueContext.Provider>
  </QueryClientProvider>)
}

describe('T17.3 admin sidebar', () => {
  it('has exactly seven destinations, grouped and accessible after collapse', async () => {
    mount()
    const nav = screen.getByRole('navigation', { name: 'Admin' })
    const labels = ['Dashboard', 'Bookings', 'Schedule', 'Open Play', 'Courts', 'Reports', 'Settings']
    expect(within(nav).getAllByRole('link')).toHaveLength(7)
    for (const label of labels) expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    expect(within(nav).getByText('Operations')).toBeInTheDocument()
    expect(within(nav).getByText('Management')).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    for (const label of labels) expect(within(nav).getByRole('link', { name: label })).toHaveAttribute('title', label)
  })

  it('keeps exactly one alert subscription while navigation changes and sidebar collapses', async () => {
    mount()
    expect(subscribeToBookingChanges).toHaveBeenCalledTimes(1)
    act(() => onChange({ booking_id: 'b1', status: 'payment_submitted', old_status: 'pending_payment', source: 'online' }))
    expect(screen.getByRole('navigation', { name: 'Admin' }).querySelector('[aria-label="Bookings, 1 new"]')).toBeInTheDocument()
    // A visible top-bar count is available even while the mobile drawer is closed.
    expect(within(screen.getByRole('banner')).getByRole('link', { name: /1 new/ })).toHaveAttribute('href', '/admin/bookings')
    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    await userEvent.click(screen.getByRole('navigation', { name: 'Admin' }).querySelector<HTMLAnchorElement>('[aria-label="Bookings, 1 new"]')!)
    expect(await screen.findByRole('heading', { name: 'Bookings page' })).toBeInTheDocument()
    expect(subscribeToBookingChanges).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('navigation', { name: 'Admin' }).querySelector('[aria-label="Bookings, 1 new"]')).toBeNull()
  })

  it('keeps venue switching and places logout inside the account control', async () => {
    vi.mocked(fetchMemberVenues).mockResolvedValue([{ id: 'venue-a', slug: 'a-venue' }, { id: 'venue-b', slug: 'b-venue' }])
    const auth = authState('admin', { venueIds: ['venue-a', 'venue-b'] })
    mount(auth)
    expect(await screen.findByRole('link', { name: 'b-venue' })).toHaveAttribute('href', '/admin?venue=b-venue')
    expect(screen.getByRole('link', { name: 'View public site' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Account' }))
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(auth.signOut).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('heading', { name: 'Login page' })).toBeInTheDocument()
  })

  it('closes the drawer by its close action and on navigation', async () => {
    mount()
    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    await userEvent.click(trigger)
    const drawer = screen.getByRole('dialog')
    expect(within(drawer).getByRole('navigation', { name: 'Admin' })).toBeInTheDocument()
    await userEvent.click(within(drawer).getByRole('button', { name: 'Close navigation' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await userEvent.click(trigger)
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Reports' }))
    expect(await screen.findByRole('heading', { name: 'Reports page' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveFocus()
    expect(subscribeToBookingChanges).toHaveBeenCalledTimes(1)
  })

  it('does not subscribe or expose navigation to a member of another venue', () => {
    mount(authState('admin', { venueIds: ['venue-b'] }))
    expect(screen.queryByRole('navigation', { name: 'Admin' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument()
    expect(subscribeToBookingChanges).not.toHaveBeenCalled()
  })
})
