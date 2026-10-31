// T13.4: a member of 2+ venues can jump to another venue's admin.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { fetchMemberVenues } from '../auth/api'
import { AuthContext, type AuthState } from '../auth/AuthContext'
import { VenueContext } from '../venue/VenueContext'
import { VenueSwitcher } from './VenueSwitcher'

vi.mock('../auth/api', () => ({ fetchMemberVenues: vi.fn() }))
const fetchMock = vi.mocked(fetchMemberVenues)

const A = { id: 'venue-a', slug: 'a-venue' }
const B = { id: 'venue-b', slug: 'b-venue' }
const C = { id: 'venue-c', slug: 'c-venue' }

function renderSwitcher(auth: AuthState = authState('admin', { venueIds: ['venue-a', 'venue-b'] })) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <VenueContext.Provider value={{ ...A, status: 'active' }}>
        <AuthContext.Provider value={auth}><VenueSwitcher /></AuthContext.Provider>
      </VenueContext.Provider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  fetchMock.mockReset()
  window.history.replaceState(null, '', '/admin')
})

describe('VenueSwitcher (T13.4)', () => {
  it('a member of one venue: renders nothing', async () => {
    fetchMock.mockResolvedValue([A])
    renderSwitcher(authState('admin', { venueIds: ['venue-a'] }))
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Venues' })).not.toBeInTheDocument())
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('anon or a player: renders nothing', () => {
    fetchMock.mockResolvedValue([])
    renderSwitcher(authState('player'))
    expect(screen.queryByRole('navigation', { name: 'Venues' })).not.toBeInTheDocument()
  })

  it('2+ venues: a "Venues" nav with a link to each OTHER venue, named by slug', async () => {
    fetchMock.mockResolvedValue([A, B, C])
    renderSwitcher(authState('admin', { venueIds: ['venue-a', 'venue-b', 'venue-c'] }))
    const nav = await screen.findByRole('navigation', { name: 'Venues' })
    expect(nav).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('admin-id')
    expect(screen.getByRole('link', { name: 'b-venue' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'c-venue' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'a-venue' })).not.toBeInTheDocument()
  })

  it('link hrefs come from venueAdminUrl (bare localhost in jsdom: /admin?venue=<slug>)', async () => {
    fetchMock.mockResolvedValue([A, B])
    renderSwitcher()
    const link = await screen.findByRole('link', { name: 'b-venue' })
    expect(link).toHaveAttribute('href', '/admin?venue=b-venue')
  })
})
