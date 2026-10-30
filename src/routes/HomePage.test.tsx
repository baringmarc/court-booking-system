// T11.23: the hero lead follows Plotline's online payments switch.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchVenueSettings, type VenueSettings } from '../features/catalog/api'
import { HomePage } from './HomePage'

vi.mock('../features/catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchVenueSettings: vi.fn(),
  fetchCourts: vi.fn().mockResolvedValue([]),
  fetchOperatingHours: vi.fn().mockResolvedValue([]),
}))
vi.mock('../features/venue/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSocialLinks: vi.fn().mockResolvedValue([]),
  fetchInfoSections: vi.fn().mockResolvedValue([]),
  fetchAmenities: vi.fn().mockResolvedValue([]),
}))

const ON = 'Pick a court and a time, then pay online with a card, GCash or Maya, or by bank transfer.'
const OFF = 'Pick a court and a time, then pay with GCash, Maya or a bank transfer.'

function renderHome(enabled: boolean) {
  vi.mocked(fetchVenueSettings).mockResolvedValue({
    venue_id: 'v1', name: 'Claudex Courts', currency: 'PHP', timezone: 'Asia/Manila', address: '', maps_url: '',
    banner_path: null, banner_alt: null, online_payments_enabled: enabled,
  } as VenueSettings)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><HomePage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('HomePage lead', () => {
  beforeEach(() => vi.mocked(fetchVenueSettings).mockReset())

  it('online payments on: mentions paying online with a card', async () => {
    renderHome(true)
    expect(await screen.findByText(ON)).toBeInTheDocument()
    expect(screen.queryByText(OFF)).not.toBeInTheDocument()
  })

  it('online payments off: only GCash, Maya or a bank transfer', async () => {
    renderHome(false)
    expect(await screen.findByText(OFF)).toBeInTheDocument()
    expect(screen.queryByText(ON)).not.toBeInTheDocument()
  })
})
