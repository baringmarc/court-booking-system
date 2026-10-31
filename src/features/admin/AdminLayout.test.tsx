import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'
import { VenueContext } from '../venue/VenueContext'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import { AdminLayout } from './AdminLayout'

vi.mock('../auth/api', () => ({ fetchMemberVenues: vi.fn().mockResolvedValue([]) }))
vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), subscribeToBookingChanges: () => () => {} }))

const VENUE = { id: 'venue-a', slug: 'a-venue', status: 'active' as const }
beforeEach(() => setCurrentVenue(VENUE))

function renderAdmin(auth = authState('admin')) {
  render(
    <QueryClientProvider client={new QueryClient()}><VenueContext.Provider value={VENUE}><AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<h1>Dashboard</h1>} />
            <Route path="bookings" element={<h1>Bookings</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider></VenueContext.Provider></QueryClientProvider>,
  )
}

describe('AdminLayout focus', () => {
  it('has a skip link as the first stop that focuses <main>', async () => {
    renderAdmin()
    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('main')).toHaveFocus()
  })

  it('moves focus to <main> after an admin page change', async () => {
    renderAdmin()
    expect(document.body).toHaveFocus()
    await userEvent.click(screen.getByRole('link', { name: 'Bookings' }))
    expect(await screen.findByRole('heading', { name: 'Bookings' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveFocus()
  })
})

describe('AdminLayout nav per venue (T13.4)', () => {
  it('shows the admin nav to a member of this venue', () => {
    renderAdmin()
    expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument()
  })

  it('hides the admin nav from a signed-in user who is a member of another venue only', () => {
    renderAdmin(authState('admin', { venueIds: ['venue-b'] }))
    expect(screen.queryByRole('navigation', { name: 'Admin' })).not.toBeInTheDocument()
  })
})
