import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext, type AuthState } from '../auth/AuthContext'
import { VenueContext } from '../venue/VenueContext'
import { AdminGuard } from './AdminGuard'

const VENUE = { id: 'venue-a', slug: 'a-venue', status: 'active' as const }

function LoginProbe() {
  const location = useLocation()
  return <p>Login page, from {(location.state as { from?: string } | null)?.from}</p>
}

function renderAt(path: string, auth: AuthState) {
  render(
    <VenueContext.Provider value={VENUE}><AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/login" element={<LoginProbe />} />
          <Route path="/admin" element={<AdminGuard />}>
            <Route path="bookings" element={<p>Bookings page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider></VenueContext.Provider>,
  )
}

describe('AdminGuard', () => {
  it('shows a loader while the session and profile load', () => {
    renderAt('/admin/bookings', authState('anon', { loading: true }))
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('Bookings page')).not.toBeInTheDocument()
  })

  it('sends signed-out visitors to /admin/login and remembers the page', () => {
    renderAt('/admin/bookings?status=pending', authState('anon'))
    expect(screen.getByText('Login page, from /admin/bookings?status=pending')).toBeInTheDocument()
  })

  it('refuses a signed-in player and offers to log out', async () => {
    const auth = authState('player')
    renderAt('/admin/bookings', auth)
    expect(screen.getByRole('heading', { name: 'Admins only' })).toBeInTheDocument()
    expect(screen.getByText(/player@example\.com, which isn't an admin account/)).toBeInTheDocument()
    expect(screen.queryByText('Bookings page')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(auth.signOut).toHaveBeenCalled()
  })

  it('renders the admin page for an admin', () => {
    renderAt('/admin/bookings', authState('admin'))
    expect(screen.getByText('Bookings page')).toBeInTheDocument()
  })

  it("doesn't call a real admin \"not an admin\" when their profile failed to load, and retries", async () => {
    const refreshProfile = vi.fn(async () => {})
    const profileError = new Error("We couldn't load your account. Check your connection and try again.")
    renderAt('/admin/bookings', authState('player', { profile: null, isAdmin: false, profileError, refreshProfile }))
    expect(screen.getByRole('heading', { name: "Couldn't load your account" })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(profileError.message)
    expect(screen.queryByText('Admins only')).not.toBeInTheDocument()
    expect(screen.queryByText('Bookings page')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refreshProfile).toHaveBeenCalledOnce()
  })

  it('refuses an admin of ANOTHER venue only (T13.4): "Admins only", not the page', () => {
    renderAt('/admin/bookings', authState('admin', { venueIds: ['venue-b'], isAdmin: true }))
    expect(screen.getByRole('heading', { name: 'Admins only' })).toBeInTheDocument()
    expect(screen.queryByText('Bookings page')).not.toBeInTheDocument()
  })

  it('lets a member of several venues in when this venue is one of them (T13.4)', () => {
    renderAt('/admin/bookings', authState('admin', { venueIds: ['venue-b', 'venue-a'] }))
    expect(screen.getByText('Bookings page')).toBeInTheDocument()
  })
})
