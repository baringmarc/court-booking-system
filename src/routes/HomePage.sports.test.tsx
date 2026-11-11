// T22.1: each sport card on / is one link to /book?sport=<sport>, in the venue's sport order.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { fetchCourts, fetchVenueSettings, type CourtWithPhotos, type VenueSettings } from '../features/catalog/api'
import { HomePage } from './HomePage'

vi.mock('../features/catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchVenueSettings: vi.fn(),
  fetchCourts: vi.fn(),
  fetchPublicSchedule: vi.fn().mockResolvedValue([]),
  fetchOperatingHours: vi.fn().mockResolvedValue([]),
}))
vi.mock('../features/venue/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSocialLinks: vi.fn().mockResolvedValue([]),
  fetchInfoSections: vi.fn().mockResolvedValue([]),
  fetchAmenities: vi.fn().mockResolvedValue([]),
}))

const mk = (id: string, name: string, sport: string) =>
  ({ id, name, sport, description: `${name} description`, default_hourly_rate: 300, is_active: true, court_photos: [] }) as unknown as CourtWithPhotos

function renderHome(courts: CourtWithPhotos[]) {
  vi.mocked(fetchVenueSettings).mockResolvedValue({
    venue_id: 'v1', name: 'Claudex Courts', currency: 'PHP', timezone: 'Asia/Manila', address: '', maps_url: '',
    banner_path: null, banner_alt: null, online_payments_enabled: true,
  } as VenueSettings)
  vi.mocked(fetchCourts).mockResolvedValue(courts)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><HomePage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('HomePage sport cards', () => {
  it('each sport card is one link named "Book <sport> courts" to /book?sport=<sport>', async () => {
    renderHome([mk('a', 'Badminton 1', 'badminton'), mk('b', 'Pickleball 1', 'pickleball'), mk('c', 'Pickleball 2', 'pickleball')])
    const pickle = await screen.findByRole('link', { name: 'Book pickleball courts' })
    expect(pickle).toHaveAttribute('href', '/book?sport=pickleball')
    const badminton = screen.getByRole('link', { name: 'Book badminton courts' })
    expect(badminton).toHaveAttribute('href', '/book?sport=badminton')
    // The card keeps its heading, count and court tiles, and the tiles add no links of their own.
    expect(within(pickle).getByRole('heading', { level: 3, name: 'Pickleball' })).toBeInTheDocument()
    expect(within(pickle).getByText(/2 courts/)).toBeInTheDocument()
    expect(within(pickle).getByText('Pickleball 2')).toBeInTheDocument()
    expect(within(pickle).queryAllByRole('link')).toHaveLength(0)
  })

  it('the sport links follow the venue sport order, and the hero Book now link stays /book', async () => {
    renderHome([mk('t', 'Tennis 1', 'tennis'), mk('b', 'Basketball 1', 'basketball'), mk('a', 'Badminton 1', 'badminton')])
    await screen.findByRole('link', { name: 'Book tennis courts' })
    const sportLinks = screen.getAllByRole('link').filter((l) => l.getAttribute('href')?.startsWith('/book?sport='))
    expect(sportLinks.map((l) => l.getAttribute('href'))).toEqual([
      '/book?sport=tennis', '/book?sport=basketball', '/book?sport=badminton',
    ])
    expect(screen.getByRole('link', { name: 'Book now' })).toHaveAttribute('href', '/book')
  })
})
