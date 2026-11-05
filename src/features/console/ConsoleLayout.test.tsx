// T17.19: sidebar navigation, mobile drawer, focus and account actions of the routed console.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
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

const { ConsoleApp } = await import('./ConsoleApp')

function Probe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderApp(auth: AuthState = authState('admin'), path = '/leads') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}><AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}><ConsoleApp /><Probe /></MemoryRouter>
    </AuthContext.Provider></QueryClientProvider>,
  )
}

const SECTIONS = ['Leads', 'Venues', 'Invoices', 'Reviews']

beforeEach(() => {
  for (const m of [mocks.admin, mocks.leads, mocks.venues, mocks.invoices, mocks.reviews]) m.mockReset()
  mocks.admin.mockResolvedValue(true)
  for (const m of [mocks.leads, mocks.venues, mocks.invoices, mocks.reviews]) m.mockResolvedValue({ rows: [], total: 0 })
})

describe('Console sidebar', () => {
  it('links to exactly Leads, Venues, Invoices and Reviews, with the active one marked aria-current', async () => {
    renderApp(authState('admin'), '/invoices')
    await screen.findByRole('heading', { level: 1, name: 'Invoices' })
    const nav = screen.getByRole('navigation', { name: 'Console' })
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(SECTIONS)
    expect(within(nav).getByRole('link', { name: 'Leads' })).toHaveAttribute('href', '/leads')
    expect(within(nav).getByRole('link', { name: 'Venues' })).toHaveAttribute('href', '/venues')
    expect(within(nav).getByRole('link', { name: 'Invoices' })).toHaveAttribute('href', '/invoices')
    expect(within(nav).getByRole('link', { name: 'Reviews' })).toHaveAttribute('href', '/reviews')
    expect(within(nav).getByRole('link', { name: 'Invoices' })).toHaveAttribute('aria-current', 'page')
    for (const other of ['Leads', 'Venues', 'Reviews']) {
      expect(within(nav).getByRole('link', { name: other })).not.toHaveAttribute('aria-current')
    }
  })

  it('navigates between sections without a reload and moves aria-current', async () => {
    renderApp()
    await screen.findByRole('heading', { level: 1, name: 'Leads' })
    const nav = screen.getByRole('navigation', { name: 'Console' })
    await userEvent.click(within(nav).getByRole('link', { name: 'Venues' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Venues' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/venues$/)
    expect(within(nav).getByRole('link', { name: 'Venues' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Leads' })).not.toHaveAttribute('aria-current')
    await userEvent.click(within(nav).getByRole('link', { name: 'Reviews' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Reviews' })).toBeInTheDocument()
    expect(mocks.reviews).toHaveBeenCalled()
  })

  it('shows who is signed in and logs out from the shell on every section', async () => {
    const auth = authState('admin')
    renderApp(auth, '/reviews')
    await screen.findByRole('heading', { level: 1, name: 'Reviews' })
    expect(screen.getAllByText('Signed in as admin@example.com', { exact: false }).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(auth.signOut).toHaveBeenCalledTimes(1)
  })

  it('has one main landmark holding the page content', async () => {
    renderApp()
    const heading = await screen.findByRole('heading', { level: 1, name: 'Leads' })
    expect(within(screen.getByRole('main')).getByRole('heading', { level: 1, name: 'Leads' })).toBe(heading)
  })
})

describe('Console mobile drawer', () => {
  it('opens from the Menu button, holds the same four links and closes on navigation', async () => {
    renderApp()
    await screen.findByRole('heading', { level: 1, name: 'Leads' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const drawer = screen.getByRole('dialog')
    const nav = within(drawer).getByRole('navigation', { name: 'Console' })
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(SECTIONS)
    expect(within(nav).getByRole('link', { name: 'Leads' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(within(nav).getByRole('link', { name: 'Invoices' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Invoices' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the Menu button', async () => {
    renderApp()
    await screen.findByRole('heading', { level: 1, name: 'Leads' })
    const menu = screen.getByRole('button', { name: 'Menu' })
    await userEvent.click(menu)
    const drawer = screen.getByRole('dialog')
    within(drawer).getAllByRole('link')[0].focus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(menu).toHaveFocus()
  })

  it('shows who is signed in and a Log out button inside the drawer too', async () => {
    const auth = authState('admin')
    renderApp(auth)
    await screen.findByRole('heading', { level: 1, name: 'Leads' })
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const drawer = screen.getByRole('dialog')
    expect(within(drawer).getByText('Signed in as admin@example.com', { exact: false })).toBeInTheDocument()
    await userEvent.click(within(drawer).getByRole('button', { name: 'Log out' }))
    expect(auth.signOut).toHaveBeenCalledTimes(1)
  })
})
