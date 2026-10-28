import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { signInWithPassword } from '../auth/api'
import { AuthContext, type AuthState } from '../auth/AuthContext'
import { AdminLoginPage } from './AdminLoginPage'

vi.mock('../auth/api', () => ({ signInWithPassword: vi.fn() }))
vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchVenueSettings: vi.fn().mockResolvedValue({ name: 'Rally Point' }),
}))
const signIn = vi.mocked(signInWithPassword)

function renderLogin(auth: AuthState, from?: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[{ pathname: '/admin/login', state: from ? { from } : null }]}>
        <Routes>
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin" element={<p>Dashboard</p>} />
          <Route path="/admin/bookings" element={<p>Bookings page</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

async function submit(email: string, password: string) {
  await userEvent.type(screen.getByLabelText('Email'), email)
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
}

describe('AdminLoginPage', () => {
  beforeEach(() => {
    signIn.mockReset()
  })

  it('offers email + password only: no Google and no sign-up', () => {
    renderLogin(authState('anon'))
    expect(screen.getByRole('heading', { name: 'Admin log in' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /sign up/i })).not.toBeInTheDocument()
  })

  it("shows the Plotline logo and names the venue's staff (T11.5)", async () => {
    renderLogin(authState('anon'))
    expect(screen.getByText('plotline')).toBeInTheDocument()
    expect(await screen.findByText('For Rally Point staff.')).toBeInTheDocument()
  })

  it('signs in with the entered credentials', async () => {
    signIn.mockResolvedValue()
    renderLogin(authState('anon'))
    await submit('ada@example.com', 'secret-123')
    expect(signIn).toHaveBeenCalledWith('ada@example.com', 'secret-123')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the sign-in error', async () => {
    signIn.mockRejectedValue(new Error('Invalid login credentials'))
    renderLogin(authState('anon'))
    await submit('ada@example.com', 'wrong')
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials')
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled()
  })

  it('sends a signed-in admin to the page they asked for', () => {
    renderLogin(authState('admin'), '/admin/bookings')
    expect(screen.getByText('Bookings page')).toBeInTheDocument()
  })

  it('defaults to the dashboard', () => {
    renderLogin(authState('admin'))
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('refuses a signed-in non-admin', () => {
    renderLogin(authState('player'))
    expect(screen.getByRole('heading', { name: 'Admins only' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })

  it('shows a retryable error, not "Admins only", when the profile failed to load', () => {
    renderLogin(authState('player', { profile: null, isAdmin: false, profileError: new Error("We couldn't load your account.") }))
    expect(screen.getByRole('heading', { name: "Couldn't load your account" })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Admins only' })).not.toBeInTheDocument()
  })
})
