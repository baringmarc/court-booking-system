import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCourts, fetchOperatingHours, fetchVenueSettings, type CourtWithPhotos, type OperatingHours, type VenueSettings,
} from '../catalog/api'
import { addDays, todayInZone } from '../../lib/time'
import { dowOf } from '../catalog/hours'
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

describe('BookPage date', () => {
  beforeEach(() => {
    vi.mocked(fetchVenueSettings).mockResolvedValue({ timezone: 'Asia/Manila', currency: 'PHP', booking_window_days: 30 } as VenueSettings)
    vi.mocked(fetchCourts).mockResolvedValue([court as unknown as CourtWithPhotos])
    vi.mocked(fetchAvailability).mockReset().mockResolvedValue([])
  })

  it('switches to tomorrow with the quick pick and disables a closed tomorrow', async () => {
    const today = todayInZone('Asia/Manila')
    const tomorrowDow = dowOf(addDays(today, 1))
    vi.mocked(fetchOperatingHours).mockResolvedValue(
      [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '00:00:00', close_time: '24:00:00', is_closed: false })) as OperatingHours[],
    )
    renderPage()
    const date = await screen.findByRole('group', { name: 'Date' })
    expect(within(date).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(date).getByRole('button', { name: 'Tomorrow' }))
    expect(vi.mocked(fetchAvailability).mock.calls.at(-1)?.[0]).toBe(addDays(today, 1))
    expect(within(date).getByRole('button', { name: 'Tomorrow' })).toHaveAttribute('aria-pressed', 'true')
    // The arrows step a day within the booking window.
    await userEvent.click(within(date).getByRole('button', { name: 'Previous day' }))
    expect(within(date).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(date).getByRole('button', { name: 'Previous day' })).toBeDisabled()
    expect(within(date).getByRole('button', { name: 'Next day' })).toBeEnabled()
    cleanup()

    vi.mocked(fetchOperatingHours).mockResolvedValue(
      [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '00:00:00', close_time: '24:00:00', is_closed: d === tomorrowDow })) as OperatingHours[],
    )
    renderPage()
    expect(within(await screen.findByRole('group', { name: 'Date' })).getByRole('button', { name: 'Tomorrow' })).toBeDisabled()
  })
})

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
