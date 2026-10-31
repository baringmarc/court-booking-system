import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentVenue, setCurrentVenue, type CurrentVenue } from '../../lib/currentVenue'
import { authState } from '../../test/authState'
import { AuthContext, type AuthState } from '../auth/AuthContext'
import { signInWithPassword } from '../auth/api'

vi.mock('./api', () => ({ fetchVenueBySlug: vi.fn() }))
vi.mock('../auth/api', () => ({ signInWithPassword: vi.fn() }))

import { fetchVenueBySlug } from './api'
import { useVenue } from './useVenue'
import { VenueOpenGate, VenueProvider } from './VenueProvider'

const fetchMock = vi.mocked(fetchVenueBySlug)
const BAY: CurrentVenue = { id: 'b0000000-0000-4000-8000-0000000000b1', slug: 'bay-courts', status: 'active' }

function Who() {
  const v = useVenue()
  return <p>venue:{v.slug}</p>
}

// AuthProvider wraps VenueProvider since T13.4.
function tree(client: QueryClient, auth: AuthState, children: React.ReactNode) {
  return (
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <VenueProvider>{children}</VenueProvider>
      </AuthContext.Provider>
    </QueryClientProvider>
  )
}

function renderProvider(children: React.ReactNode = <Who />, auth: AuthState = authState('anon')) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(tree(client, auth, children))
  return { ...utils, rerenderWith: (next: AuthState) => utils.rerender(tree(client, next, children)) }
}

beforeEach(() => {
  setCurrentVenue(null)
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/?venue=bay-courts')
  fetchMock.mockReset()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('VenueProvider (T13.3)', () => {
  it('shows the loader while the venue loads', () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    renderProvider()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('found: looks up the slug from the page, sets the current venue and renders children', async () => {
    fetchMock.mockResolvedValue(BAY)
    renderProvider()
    expect(await screen.findByText('venue:bay-courts')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('bay-courts')
    expect(currentVenue()).toEqual(BAY)
  })

  it('sets the current venue before the children render', async () => {
    fetchMock.mockResolvedValue(BAY)
    function Probe() {
      return <p>probe:{currentVenue().id}</p>
    }
    renderProvider(<Probe />)
    expect(await screen.findByText(`probe:${BAY.id}`)).toBeInTheDocument()
  })

  it('not found: a null venue shows "Venue not found" and no children', async () => {
    fetchMock.mockResolvedValue(null)
    renderProvider()
    expect(await screen.findByRole('heading', { name: 'Venue not found' })).toBeInTheDocument()
    expect(screen.queryByText(/venue:/)).not.toBeInTheDocument()
  })

  it('no slug and no default: "Venue not found" and no fetch', async () => {
    window.history.replaceState(null, '', '/')
    renderProvider()
    expect(await screen.findByRole('heading', { name: 'Venue not found' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('no slug falls back to VITE_DEFAULT_VENUE', async () => {
    window.history.replaceState(null, '', '/')
    vi.stubEnv('VITE_DEFAULT_VENUE', 'claudex-courts')
    fetchMock.mockResolvedValue({ ...BAY, slug: 'claudex-courts' })
    renderProvider()
    expect(await screen.findByText('venue:claudex-courts')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('claudex-courts')
  })

  it('the page slug wins over VITE_DEFAULT_VENUE', async () => {
    vi.stubEnv('VITE_DEFAULT_VENUE', 'claudex-courts')
    fetchMock.mockResolvedValue(BAY)
    renderProvider()
    await screen.findByText('venue:bay-courts')
    expect(fetchMock).toHaveBeenCalledWith('bay-courts')
    expect(fetchMock).not.toHaveBeenCalledWith('claudex-courts')
  })

  it('a failed fetch shows an alert, and "Try again" refetches', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    renderProvider()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fetchMock.mockResolvedValue(BAY)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('venue:bay-courts')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('useVenue throws outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Who />)).toThrow()
    spy.mockRestore()
  })
})

describe('VenueOpenGate (T13.3)', () => {
  it('active: renders the children', async () => {
    fetchMock.mockResolvedValue(BAY)
    renderProvider(<VenueOpenGate><p>booking page</p></VenueOpenGate>)
    expect(await screen.findByText('booking page')).toBeInTheDocument()
  })

  it.each(['draft', 'suspended', 'closed'] as const)('%s: shows "Not taking bookings" and no children', async (status) => {
    fetchMock.mockResolvedValue({ ...BAY, status })
    renderProvider(<VenueOpenGate><p>booking page</p></VenueOpenGate>)
    expect(await screen.findByRole('heading', { name: 'Not taking bookings' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('booking page')).not.toBeInTheDocument())
  })
})

describe('VenueProvider staff sign-in (T13.4)', () => {
  const signIn = vi.mocked(signInWithPassword)

  beforeEach(() => {
    signIn.mockReset()
    window.history.replaceState(null, '', '/admin?venue=bay-courts')
  })

  it('anon on /admin with an invisible venue: shows the staff sign-in form, not "Venue not found"', async () => {
    fetchMock.mockResolvedValue(null)
    renderProvider()
    expect(await screen.findByRole('heading', { name: 'Staff sign in' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Venue not found' })).not.toBeInTheDocument()
  })

  it('also on /admin/bookings (any path under /admin)', async () => {
    window.history.replaceState(null, '', '/admin/bookings?venue=bay-courts')
    fetchMock.mockResolvedValue(null)
    renderProvider()
    expect(await screen.findByRole('heading', { name: 'Staff sign in' })).toBeInTheDocument()
  })

  it('submitting calls signInWithPassword with the entered credentials', async () => {
    fetchMock.mockResolvedValue(null)
    signIn.mockResolvedValue()
    renderProvider()
    await userEvent.type(await screen.findByLabelText('Email'), 'ada@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'secret-123')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(signIn).toHaveBeenCalledWith('ada@example.com', 'secret-123')
  })

  it('shows the sign-in error message', async () => {
    fetchMock.mockResolvedValue(null)
    signIn.mockRejectedValue(new Error('Invalid login credentials'))
    renderProvider()
    await userEvent.type(await screen.findByLabelText('Email'), 'ada@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials')
  })

  it('off /admin an invisible venue is still "Venue not found" for anon', async () => {
    window.history.replaceState(null, '', '/?venue=bay-courts')
    fetchMock.mockResolvedValue(null)
    renderProvider()
    expect(await screen.findByRole('heading', { name: 'Venue not found' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Staff sign in' })).not.toBeInTheDocument()
  })

  it('signed in on /admin but not a member (venue still invisible): "Venue not found"', async () => {
    fetchMock.mockResolvedValue(null)
    renderProvider(<Who />, authState('player'))
    expect(await screen.findByRole('heading', { name: 'Venue not found' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Staff sign in' })).not.toBeInTheDocument()
  })

  it('refetches the venue after sign-in (the query key includes the user)', async () => {
    fetchMock.mockResolvedValueOnce(null)
    const { rerenderWith } = renderProvider()
    expect(await screen.findByRole('heading', { name: 'Staff sign in' })).toBeInTheDocument()
    fetchMock.mockResolvedValue({ ...BAY, status: 'draft' })
    rerenderWith(authState('admin'))
    expect(await screen.findByText('venue:bay-courts')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
