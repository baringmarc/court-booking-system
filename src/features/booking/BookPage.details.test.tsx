// T27.6: the "About the … courts" details start collapsed so the slot grid is reachable sooner on phones.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCourts, fetchPublicSchedule, fetchVenueSettings, type CourtWithPhotos, type VenueSettings,
} from '../catalog/api'
import { fetchAvailability } from './api'
import { BookPage } from './BookPage'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourts: vi.fn(),
  fetchPublicSchedule: vi.fn(),
  fetchVenueSettings: vi.fn(),
}))
vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchAvailability: vi.fn() }))

const mk = (id: string, name: string, sport: string) =>
  ({ id, name, sport, description: '', is_active: true, court_photos: [] }) as unknown as CourtWithPhotos

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/book?sport=tennis']}><BookPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BookPage court details', () => {
  beforeEach(() => {
    vi.mocked(fetchVenueSettings).mockResolvedValue({ timezone: 'Asia/Manila', currency: 'PHP', booking_window_days: 30 } as VenueSettings)
    vi.mocked(fetchCourts).mockResolvedValue([mk('A', 'Tennis 1', 'tennis'), mk('B', 'Tennis 2', 'tennis')])
    vi.mocked(fetchPublicSchedule).mockResolvedValue([])
    vi.mocked(fetchAvailability).mockResolvedValue([])
  })

  it('starts collapsed, opens on a click of the summary and closes on a second click', async () => {
    const user = userEvent.setup()
    renderPage()
    const summary = await screen.findByText('About the tennis courts')
    const details = summary.closest('details')!
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')

    await user.click(summary)
    expect(details).toHaveAttribute('open')

    await user.click(summary)
    expect(details).not.toHaveAttribute('open')
  })
})
