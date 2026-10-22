import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCourts, fetchOperatingHours, fetchVenueSettings, type CourtWithPhotos, type OperatingHours, type VenueSettings,
} from '../catalog/api'
import { fetchAvailability } from './api'
import { BookPage } from './BookPage'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourts: vi.fn(),
  fetchOperatingHours: vi.fn(),
  fetchVenueSettings: vi.fn(),
}))
vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchAvailability: vi.fn() }))

const court = { id: 'A', name: 'Badminton 1', sport: 'badminton', description: 'Wooden floor, good lights.', is_active: true, court_photos: [] }

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/book']}><BookPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BookPage court details', () => {
  beforeEach(() => {
    vi.mocked(fetchVenueSettings).mockResolvedValue({ timezone: 'Asia/Manila', currency: 'PHP', booking_window_days: 30 } as VenueSettings)
    vi.mocked(fetchCourts).mockResolvedValue([court as unknown as CourtWithPhotos])
    vi.mocked(fetchOperatingHours).mockResolvedValue(
      [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '06:00:00', close_time: '22:00:00', is_closed: false })) as OperatingHours[],
    )
    vi.mocked(fetchAvailability).mockResolvedValue([])
  })

  it('starts with "About the … courts" open, and players can collapse it', async () => {
    renderPage()
    const summary = await screen.findByText('About the badminton courts')
    const details = summary.closest('details')!
    expect(details).toHaveAttribute('open')
    expect(screen.getByText('Wooden floor, good lights.')).toBeVisible()
    await userEvent.click(summary)
    expect(details).not.toHaveAttribute('open')
  })
})
