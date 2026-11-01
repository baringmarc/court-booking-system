import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { User } from '@supabase/supabase-js'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext, type AuthState } from '../auth/AuthContext'
import { VenueContext } from '../venue/VenueContext'
import { AdminGuard } from './AdminGuard'

vi.mock('../auth/api', () => ({ setPassword: vi.fn(async () => {}) }))

const VENUE = { id: 'venue-a', slug: 'a-venue', status: 'active' as const }

function invitedUser(extra: Record<string, unknown> = {}, providers = ['email']): User {
  return {
    id: 'admin-id', email: 'admin@example.com', invited_at: '2030-01-01T00:00:00Z',
    user_metadata: {}, app_metadata: { provider: providers[0], providers },
    identities: providers.map((p) => ({ provider: p, id: `${p}-id`, user_id: 'admin-id', identity_data: {} })),
    ...extra,
  } as unknown as User
}

function renderGuard(auth: AuthState) {
  render(
    <VenueContext.Provider value={VENUE}><AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/admin/bookings']}>
        <Routes>
          <Route path="/admin" element={<AdminGuard />}>
            <Route path="bookings" element={<p>Bookings page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider></VenueContext.Provider>,
  )
}

describe('AdminGuard set-password gate (T14.5b)', () => {
  it('shows the prompt instead of the page for an invited admin without a password', () => {
    renderGuard(authState('admin', { user: invitedUser() }))
    expect(screen.getByRole('heading', { name: 'Set your password' })).toBeInTheDocument()
    expect(screen.queryByText('Bookings page')).not.toBeInTheDocument()
  })

  it('shows the page after the prompt is skipped', async () => {
    renderGuard(authState('admin', { user: invitedUser() }))
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(screen.getByText('Bookings page')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Set your password' })).not.toBeInTheDocument()
  })

  it('shows the page after the password is set', async () => {
    renderGuard(authState('admin', { user: invitedUser() }))
    await userEvent.type(screen.getByLabelText('New password'), 'longenough1')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'longenough1')
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(await screen.findByText('Bookings page')).toBeInTheDocument()
  })

  it('shows the page immediately for an admin who was not invited', () => {
    renderGuard(authState('admin'))
    expect(screen.getByText('Bookings page')).toBeInTheDocument()
  })

  it('shows the page immediately when the invited admin already set a password', () => {
    renderGuard(authState('admin', { user: invitedUser({ user_metadata: { password_set: true } }) }))
    expect(screen.getByText('Bookings page')).toBeInTheDocument()
  })

  it('shows the page immediately for a Google-only invited admin', () => {
    renderGuard(authState('admin', { user: invitedUser({}, ['google']) }))
    expect(screen.getByText('Bookings page')).toBeInTheDocument()
  })
})
