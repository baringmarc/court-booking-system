import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCourt, fetchCourtRates, fetchCourts, fetchOperatingHours, fetchVenueSettings, saveCourt,
  type Court, type CourtWithPhotos, type VenueSettings,
} from '../catalog/api'
import { CourtEditPage } from './CourtEditPage'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourt: vi.fn(),
  fetchCourts: vi.fn(),
  fetchCourtRates: vi.fn(),
  fetchOperatingHours: vi.fn(),
  fetchVenueSettings: vi.fn(),
  saveCourt: vi.fn(),
}))
vi.mock('../catalog/media', () => ({ mediaUrl: (path: string) => `https://cdn.test/${path}` }))

const court = { id: 'b2', name: 'Badminton 2', sport: 'badminton' as Court['sport'], sort_order: 4, is_active: true,
  default_hourly_rate: 350, description: '', court_photos: [] as CourtWithPhotos['court_photos'] } as CourtWithPhotos

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/admin/courts/:id" element={<CourtEditPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CourtEditPage after the schedule cutover (T17.17)', () => {
  beforeEach(() => {
    vi.mocked(fetchCourts).mockReset().mockResolvedValue([court])
    vi.mocked(fetchCourt).mockReset().mockResolvedValue(court)
    vi.mocked(fetchCourtRates).mockReset().mockResolvedValue([])
    vi.mocked(fetchOperatingHours).mockReset().mockResolvedValue([])
    vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ currency: 'PHP' } as VenueSettings)
    vi.mocked(saveCourt).mockReset().mockResolvedValue(court)
  })

  it('no longer renders the weekly rate editor', async () => {
    renderAt('/admin/courts/b2')
    await screen.findByRole('button', { name: 'Save changes' })
    expect(screen.queryByRole('heading', { name: 'Rates' })).not.toBeInTheDocument()
    expect(fetchCourtRates).not.toHaveBeenCalled()
  })

  it('links to Weekly Hours & Rates at /admin/schedule instead', async () => {
    renderAt('/admin/courts/b2')
    const link = await screen.findByRole('link', { name: /weekly hours/i })
    expect(link).toHaveAttribute('href', '/admin/schedule')
  })

  it('still edits the court name and default rate', async () => {
    renderAt('/admin/courts/b2')
    expect(await screen.findByLabelText('Name')).toHaveValue('Badminton 2')
    expect(screen.getByLabelText('Default hourly rate')).toHaveValue(350)
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })
})
