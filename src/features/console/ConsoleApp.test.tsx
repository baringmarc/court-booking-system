import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext, type AuthState } from '../auth/AuthContext'

vi.mock('./api', () => ({ fetchIsPlatformAdmin: vi.fn(), fetchLeads: vi.fn(), updateLead: vi.fn(), fetchVenuesOverview: vi.fn(async () => []), fetchInvoicesOverview: vi.fn(async () => []), fetchReviews: vi.fn(async () => []) }))
vi.mock('../auth/api', () => ({ signInWithPassword: vi.fn() }))

const { fetchIsPlatformAdmin, fetchLeads } = await import('./api')
const { ConsoleApp } = await import('./ConsoleApp')

// Deliberately no VenueContext/VenueProvider: the console host has no venue.
function renderApp(auth: AuthState) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><AuthContext.Provider value={auth}><ConsoleApp /></AuthContext.Provider></QueryClientProvider>)
}

describe('ConsoleApp', () => {
  beforeEach(() => { vi.mocked(fetchLeads).mockReset() })

  it('shows the console shell to a platform admin, with their email and a log out button, without any venue context', async () => {
    vi.mocked(fetchIsPlatformAdmin).mockResolvedValue(true)
    vi.mocked(fetchLeads).mockResolvedValue([])
    const auth = authState('admin')
    renderApp(auth)
    expect(await screen.findByRole('heading', { name: 'Platform console' })).toBeInTheDocument()
    expect(screen.getByText(/admin@example\.com/)).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Console' })
    expect(within(nav).getByText('Leads')).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByText('No leads yet.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(auth.signOut).toHaveBeenCalled()
  })

  it('refuses a signed-in user who is not a platform admin', async () => {
    vi.mocked(fetchIsPlatformAdmin).mockResolvedValue(false)
    renderApp(authState('admin'))
    expect(await screen.findByRole('heading', { name: 'Platform admins only' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Console' })).not.toBeInTheDocument()
    expect(fetchLeads).not.toHaveBeenCalled()
  })

  it('asks a signed-out visitor to sign in', () => {
    renderApp(authState('anon'))
    expect(screen.getByRole('heading', { name: 'Platform console' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Console' })).not.toBeInTheDocument()
    expect(fetchLeads).not.toHaveBeenCalled()
  })
})
