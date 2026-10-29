// T11.24: the address and quick facts sit in the hero; the Location card is gone from the home page.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCourts, fetchVenueSettings, type CourtWithPhotos, type VenueSettings } from '../features/catalog/api'
import { HomePage } from './HomePage'

vi.mock('../features/catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchVenueSettings: vi.fn(),
  fetchCourts: vi.fn(),
  fetchOperatingHours: vi.fn().mockResolvedValue([]),
}))
vi.mock('../features/venue/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSocialLinks: vi.fn().mockResolvedValue([]),
  fetchInfoSections: vi.fn().mockResolvedValue([]),
  fetchAmenities: vi.fn().mockResolvedValue([]),
}))

const MAPS = 'https://maps.app.goo.gl/E2eAyalaTriangle'
const court = (id: string) => ({
  id, name: `Court ${id}`, sport: 'pickleball', description: 'd', default_hourly_rate: 500, is_active: true, court_photos: [],
}) as unknown as CourtWithPhotos

function renderHome(courts: 'ok3' | 'ok1' | 'pending' | 'error' = 'ok3', settings: Partial<VenueSettings> = {}) {
  vi.mocked(fetchVenueSettings).mockResolvedValue({
    id: true, name: 'Claudex Courts', currency: 'PHP', timezone: 'Asia/Manila', slot_minutes: 60,
    address: '123 Rizal Ave, Makati City', maps_url: MAPS, banner_path: null, banner_alt: null,
    online_payments_enabled: true, ...settings,
  } as VenueSettings)
  if (courts === 'pending') vi.mocked(fetchCourts).mockReturnValue(new Promise(() => {}))
  else if (courts === 'error') vi.mocked(fetchCourts).mockRejectedValue(new Error('boom'))
  else vi.mocked(fetchCourts).mockResolvedValue(courts === 'ok3' ? [court('1'), court('2'), court('3')] : [court('1')])
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><HomePage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const hero = () => screen.getByRole('heading', { level: 1 }).closest('.hero') as HTMLElement

describe('HomePage hero (T11.24)', () => {
  beforeEach(() => {
    vi.mocked(fetchVenueSettings).mockReset()
    vi.mocked(fetchCourts).mockReset()
  })

  it('shows the address as a Maps link and the quick facts in the hero', async () => {
    renderHome('ok3')
    const link = await within(hero()).findByRole('link', { name: /123 Rizal Ave, Makati City/ })
    expect(link).toHaveAttribute('href', MAPS)
    expect(link).toHaveAttribute('target', '_blank')
    const facts = await within(hero()).findByRole('list', { name: 'Quick facts' })
    expect(within(facts).getAllByRole('listitem').map((i) => i.textContent?.trim())).toEqual(['3 courts', '60-min slots'])
  })

  it('one active court reads "1 court"', async () => {
    renderHome('ok1')
    expect(await within(hero()).findByText('1 court')).toBeInTheDocument()
  })

  it('no "Location" region on the home page', async () => {
    renderHome('ok3')
    await within(hero()).findByRole('link', { name: /123 Rizal Ave/ })
    expect(screen.queryByRole('region', { name: 'Location' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Location' })).not.toBeInTheDocument()
  })

  it('no address: nothing in the hero for it', async () => {
    renderHome('ok3', { address: '' })
    await within(hero()).findByRole('list', { name: 'Quick facts' })
    expect(screen.queryByText(/Rizal/)).not.toBeInTheDocument()
  })

  it('courts fact is hidden while courts load; slot length still shows', async () => {
    renderHome('pending')
    expect(await within(hero()).findByText('60-min slots')).toBeInTheDocument()
    expect(screen.queryByText(/\d+ courts?$/)).not.toBeInTheDocument()
  })

  it('courts fact is hidden when courts fail to load', async () => {
    renderHome('error')
    expect(await within(hero()).findByText('60-min slots')).toBeInTheDocument()
    await waitFor(() => expect(fetchCourts).toHaveBeenCalled())
    expect(within(hero()).queryByText(/^\d+ courts?$/)).not.toBeInTheDocument()
  })
})
