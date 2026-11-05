// T14.1 guard behaviour kept; T17.19: the console is routed (/leads, /venues, /invoices, /reviews) inside the guard.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext, type AuthState } from '../auth/AuthContext'

const mocks = vi.hoisted(() => ({
  admin: vi.fn<() => Promise<boolean>>(),
  leads: vi.fn(), venues: vi.fn(), invoices: vi.fn(), reviews: vi.fn(),
}))
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  fetchIsPlatformAdmin: mocks.admin, fetchLeadsPage: mocks.leads, fetchVenuesPage: mocks.venues,
  fetchInvoicesPage: mocks.invoices, fetchReviewsPage: mocks.reviews,
}))
vi.mock('../auth/api', () => ({ signInWithPassword: vi.fn() }))

const { ConsoleApp } = await import('./ConsoleApp')

function Probe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

// Deliberately no VenueContext/VenueProvider: the console host has no venue.
function renderApp(auth: AuthState, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}><AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}><ConsoleApp /><Probe /></MemoryRouter>
    </AuthContext.Provider></QueryClientProvider>,
  )
}

beforeEach(() => {
  for (const m of [mocks.admin, mocks.leads, mocks.venues, mocks.invoices, mocks.reviews]) m.mockReset()
  for (const m of [mocks.leads, mocks.venues, mocks.invoices, mocks.reviews]) m.mockResolvedValue({ rows: [], total: 0 })
})

describe('ConsoleApp', () => {
  it('shows the console shell to a platform admin, with their email and a log out button, without any venue context', async () => {
    mocks.admin.mockResolvedValue(true)
    const auth = authState('admin')
    renderApp(auth)
    expect(await screen.findByRole('heading', { level: 1, name: 'Leads' })).toBeInTheDocument()
    expect(screen.getAllByText(/Signed in as admin@example\.com/).length).toBeGreaterThan(0)
    expect(screen.getByRole('navigation', { name: 'Console' })).toBeInTheDocument()
    expect(await screen.findByText('No leads yet.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(auth.signOut).toHaveBeenCalled()
  })

  it('redirects / to /leads', async () => {
    mocks.admin.mockResolvedValue(true)
    renderApp(authState('admin'), '/')
    await screen.findByRole('heading', { level: 1, name: 'Leads' })
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/leads$/)
  })

  it('redirects an unknown path to /leads', async () => {
    mocks.admin.mockResolvedValue(true)
    renderApp(authState('admin'), '/nope/at-all')
    await screen.findByRole('heading', { level: 1, name: 'Leads' })
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/leads$/)
  })

  it.each([['/venues', 'Venues'], ['/invoices', 'Invoices'], ['/reviews', 'Reviews'], ['/leads', 'Leads']])(
    'opens %s directly with the section name as its h1',
    async (path, name) => {
      mocks.admin.mockResolvedValue(true)
      renderApp(authState('admin'), path)
      expect(await screen.findByRole('heading', { level: 1, name })).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent(new RegExp(`^${path}$`))
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    },
  )

  it('refuses a signed-in user who is not a platform admin, on any route', async () => {
    mocks.admin.mockResolvedValue(false)
    renderApp(authState('admin'), '/invoices')
    expect(await screen.findByRole('heading', { name: 'Platform admins only' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Console' })).not.toBeInTheDocument()
    for (const m of [mocks.leads, mocks.venues, mocks.invoices, mocks.reviews]) expect(m).not.toHaveBeenCalled()
  })

  it('asks a signed-out visitor to sign in', () => {
    renderApp(authState('anon'), '/venues')
    expect(screen.getByRole('heading', { name: 'Platform console' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Console' })).not.toBeInTheDocument()
    for (const m of [mocks.leads, mocks.venues, mocks.invoices, mocks.reviews]) expect(m).not.toHaveBeenCalled()
  })
})
