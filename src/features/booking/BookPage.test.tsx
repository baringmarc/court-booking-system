import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCourts, fetchPublicSchedule, fetchVenueSettings, type CourtWithPhotos, type PublicSchedulePeriod, type VenueSettings,
} from '../catalog/api'
import { addDays, todayInZone } from '../../lib/time'
import { dowOf } from '../catalog/hours'
import { fetchAvailability } from './api'
import { BookPage } from './BookPage'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourts: vi.fn(),
  fetchPublicSchedule: vi.fn(),
  fetchVenueSettings: vi.fn(),
}))
vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchAvailability: vi.fn() }))

const court = { id: 'A', name: 'Badminton 1', sport: 'badminton', description: 'Wooden floor, good lights.', is_active: true, court_photos: [] }

function schedule(closedDow = -1): PublicSchedulePeriod[] {
  const today = todayInZone('Asia/Manila')
  return Array.from({ length: 31 }, (_, index) => addDays(today, index))
    .filter((date) => dowOf(date) !== closedDow)
    .map((date) => ({ court_id: 'A', operating_date: date,
      period_start: new Date(`${date}T00:00:00+08:00`).toISOString(),
      period_end: new Date(`${addDays(date, 1)}T00:00:00+08:00`).toISOString(),
      booking_start: today, booking_end: addDays(today, 30) }))
}

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

  it("picks tomorrow from the date strip and greys out a closed tomorrow (T11.4a)", async () => {
    const today = todayInZone('Asia/Manila')
    const tomorrowDow = dowOf(addDays(today, 1))
    vi.mocked(fetchPublicSchedule).mockResolvedValue(schedule())
    renderPage()
    const date = await screen.findByRole('group', { name: 'Date' })
    const tiles = () => within(date).getAllByRole('button').filter((b) => b.classList.contains('date-tile'))
    expect(tiles()).toHaveLength(10)
    expect(tiles()[0]).toHaveAccessibleName(/, today$/)
    expect(tiles()[0]).toHaveAttribute('aria-pressed', 'true')
    expect(within(date).getByText('Today')).toBeInTheDocument()
    await userEvent.click(tiles()[1])
    expect(vi.mocked(fetchAvailability).mock.calls.at(-1)?.[0]).toBe(addDays(today, 1))
    expect(tiles()[1]).toHaveAttribute('aria-pressed', 'true')
    expect(within(date).getByText('Tomorrow')).toBeInTheDocument()
    // The arrows step a day within the booking window.
    await userEvent.click(within(date).getByRole('button', { name: 'Previous day' }))
    expect(tiles()[0]).toHaveAttribute('aria-pressed', 'true')
    expect(within(date).getByRole('button', { name: 'Previous day' })).toBeDisabled()
    expect(within(date).getByRole('button', { name: 'Next day' })).toBeEnabled()
    cleanup()

    vi.mocked(fetchPublicSchedule).mockResolvedValue(schedule(tomorrowDow))
    renderPage()
    const again = await screen.findByRole('group', { name: 'Date' })
    const tomorrow = within(again).getAllByRole('button').filter((b) => b.classList.contains('date-tile'))[1]
    expect(tomorrow).toBeDisabled()
    expect(tomorrow).toHaveAccessibleName(/, closed$/)
  })
})

describe('BookPage court details', () => {
  beforeEach(() => {
    vi.mocked(fetchVenueSettings).mockResolvedValue({ timezone: 'Asia/Manila', currency: 'PHP', booking_window_days: 30 } as VenueSettings)
    vi.mocked(fetchCourts).mockResolvedValue([court as unknown as CourtWithPhotos])
    vi.mocked(fetchPublicSchedule).mockResolvedValue(schedule())
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
