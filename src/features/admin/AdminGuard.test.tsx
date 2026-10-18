import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext, type AuthState } from '../auth/AuthContext'
import { AdminGuard } from './AdminGuard'

function LoginProbe() {
  const location = useLocation()
  return <p>Login page, from {(location.state as { from?: string } | null)?.from}</p>
}

function renderAt(path: string, auth: AuthState) {
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/login" element={<LoginProbe />} />
          <Route path="/admin" element={<AdminGuard />}>
            <Route path="bookings" element={<p>Bookings page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
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
})
