// Hotfix: the home page's "Upcoming court hours" is a short summary, not one line per court per day.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCourts, fetchPublicSchedule, fetchVenueSettings, type CourtWithPhotos, type PublicSchedulePeriod, type VenueSettings,
} from '../features/catalog/api'
import { HomePage } from './HomePage'

vi.mock('../features/catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchVenueSettings: vi.fn(),
  fetchCourts: vi.fn(),
  fetchPublicSchedule: vi.fn(),
  fetchOperatingHours: vi.fn().mockResolvedValue([]),
}))
vi.mock('../features/venue/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSocialLinks: vi.fn().mockResolvedValue([]),
  fetchInfoSections: vi.fn().mockResolvedValue([]),
  fetchAmenities: vi.fn().mockResolvedValue([]),
}))

const NAMES = ['Basketball Court', 'Pickleball 1', 'Pickleball 2', 'Pickleball 3', 'Tennis Court', 'Badminton Court']
const courtRows = NAMES.map((name, i) => ({
  id: `c${i}`, name, sport: 'pickleball', description: 'd', default_hourly_rate: 500, is_active: true, court_photos: [],
}) as unknown as CourtWithPhotos)
const DATES = ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']
const schedule: PublicSchedulePeriod[] = courtRows.flatMap((c) => DATES.map((d) => ({
  court_id: c.id, operating_date: d, period_start: `${d}T06:00:00+08:00`, period_end: `${d}T22:00:00+08:00`,
  booking_start: '2026-11-06', booking_end: '2026-12-06',
})))

function renderHome() {
  vi.mocked(fetchVenueSettings).mockResolvedValue({
    id: true, name: 'Claudex Courts', currency: 'PHP', timezone: 'Asia/Manila', slot_minutes: 60,
    address: '', maps_url: null, banner_path: null, banner_alt: null, online_payments_enabled: true,
  } as unknown as VenueSettings)
  vi.mocked(fetchCourts).mockResolvedValue(courtRows)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><HomePage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('HomePage upcoming court hours (hotfix)', () => {
  beforeEach(() => {
    vi.mocked(fetchVenueSettings).mockReset()
    vi.mocked(fetchCourts).mockReset()
    vi.mocked(fetchPublicSchedule).mockReset()
  })

  it('six courts open 6 AM-10 PM all week show one summary line', async () => {
    vi.mocked(fetchPublicSchedule).mockResolvedValue(schedule)
    renderHome()
    const list = await screen.findByRole('list', { name: 'Upcoming court hours' })
    expect(within(list).getAllByRole('listitem').map((i) => i.textContent?.trim())).toEqual(['Open daily, 6 AM – 10 PM'])
    expect(screen.queryByText(/Basketball Court: Fri/)).not.toBeInTheDocument()
  })

  it('shows "Loading court hours…" while the schedule is pending', async () => {
    vi.mocked(fetchPublicSchedule).mockReturnValue(new Promise(() => {}))
    renderHome()
    expect(await screen.findByText('Loading court hours…')).toBeInTheDocument()
  })

  it('shows "No upcoming court hours." when the schedule is empty', async () => {
    vi.mocked(fetchPublicSchedule).mockResolvedValue([])
    renderHome()
    expect(await screen.findByText('No upcoming court hours.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Upcoming court hours' })).not.toBeInTheDocument()
  })

  it('shows the error with a retry when the schedule fails', async () => {
    vi.mocked(fetchPublicSchedule).mockRejectedValue(new Error('boom'))
    renderHome()
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
