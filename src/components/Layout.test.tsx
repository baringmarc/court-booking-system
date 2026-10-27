import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Link, MemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { authState } from '../test/authState'
import { AuthContext } from '../features/auth/AuthContext'
import { Layout } from './Layout'
import { fetchVenueSettings } from '../features/catalog/api'

// The footer reads the venue's social links (T9.11i); none here. The header and footer show the venue's name.
vi.mock('../features/venue/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSocialLinks: vi.fn().mockResolvedValue([]),
}))
vi.mock('../features/catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchVenueSettings: vi.fn().mockResolvedValue({ name: 'Rally Point' }),
}))

const withClient = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
)

function Hash() {
  return <p>hash:{useLocation().hash}</p>
}

/** The public layout over two pages, so tests can navigate between them. */
function renderLayout(initialEntry = '/') {
  const router = createMemoryRouter(
    [{
      element: <Layout />,
      children: [
        { path: '/', element: <><h1>Home</h1><Link to="/next">Go next</Link></> },
        { path: '/next', element: <><h1>Next page</h1><Hash /></> },
        { path: '/book', element: <h1>Book page</h1> },
      ],
    }],
    { initialEntries: [initialEntry] },
  )
  render(withClient(
    <AuthContext.Provider value={authState('anon')}>
      <RouterProvider router={router} />
    </AuthContext.Provider>),
  )
}

describe('Layout (public header)', () => {
  it('has no Admin link, even for an admin', () => {
    render(withClient(
      <AuthContext.Provider value={authState('admin')}>
        <MemoryRouter><Layout /></MemoryRouter>
      </AuthContext.Provider>),
    )
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(nav).toHaveTextContent('Book')
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()
  })
})

describe('Layout (venue name and footer, T11.4)', () => {
  it("heads the site with the venue's name, linked home, and marks the current tab", async () => {
    renderLayout('/book')
    expect(await screen.findByRole('link', { name: 'Rally Point' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Book' })).toHaveAttribute('aria-current', 'page')
  })

  it('ends with the copyright and "Powered by plotline"', async () => {
    renderLayout()
    const footer = screen.getByRole('contentinfo')
    expect(await within(footer).findByText(new RegExp(`© ${new Date().getFullYear()} Rally Point`))).toBeInTheDocument()
    expect(footer).toHaveTextContent('Powered by plotline')
    // No social links, so no "Stay connected" band.
    expect(within(footer).queryByRole('heading', { name: 'Connect with us' })).not.toBeInTheDocument()
  })
})

describe('Layout without the venue name (T11.4)', () => {
  it('keeps a named home link and a bare copyright while settings are loading or failed', async () => {
    vi.mocked(fetchVenueSettings).mockRejectedValueOnce(new Error('boom'))
    renderLayout()
    await vi.waitFor(() => expect(fetchVenueSettings).toHaveBeenCalled())
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(within(screen.getByRole('contentinfo')).getByText(`© ${new Date().getFullYear()}`)).toBeInTheDocument()
  })
})

describe('Layout focus', () => {
  it('leaves focus alone on the first page', () => {
    renderLayout()
    expect(document.body).toHaveFocus()
  })

  it('moves focus to <main> after a page change', async () => {
    renderLayout()
    await userEvent.click(screen.getByRole('link', { name: 'Book' }))
    expect(screen.getByRole('main')).toHaveFocus()
  })

  it('moves focus to <main> when the link that was used goes away', async () => {
    renderLayout()
    await userEvent.click(screen.getByRole('link', { name: 'Go next' }))
    expect(await screen.findByRole('heading', { name: 'Next page' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveFocus()
  })

  it('has a skip link as the first stop that focuses <main> without changing the hash', async () => {
    renderLayout('/next#token=secret')
    await userEvent.tab()
    const skip = screen.getByRole('link', { name: 'Skip to main content' })
    expect(skip).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('main')).toHaveFocus()
    expect(screen.getByText('hash:#token=secret')).toBeInTheDocument()
  })
})
