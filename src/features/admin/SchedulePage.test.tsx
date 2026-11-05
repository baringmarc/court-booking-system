import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { createBlackout, fetchCourts, fetchUpcomingBlackouts, fetchVenueSettings, type VenueSettings } from '../catalog/api'
import { fetchSchedule } from './api'
import { SchedulePage } from './SchedulePage'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createBlackout: vi.fn(),
  fetchCourts: vi.fn(),
  fetchUpcomingBlackouts: vi.fn(),
  fetchVenueSettings: vi.fn(),
}))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSchedule: vi.fn(),
  saveSchedule: vi.fn(),
}))

const emptySchedule = {
  venue_id: 'v1',
  schedule_revision: 0,
  venue_periods: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_minute: 360, end_minute: 1320 })),
  courts: [],
}

function renderPage() {
  vi.mocked(fetchSchedule).mockResolvedValue(emptySchedule as never)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([{ path: '/', element: <SchedulePage /> }])
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}

describe('SchedulePage sections (T17.15)', () => {
  beforeEach(() => {
    vi.mocked(fetchCourts).mockReset().mockResolvedValue([])
    vi.mocked(fetchUpcomingBlackouts).mockReset().mockResolvedValue([])
    vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila' } as VenueSettings)
    vi.mocked(fetchSchedule).mockReset()
  })

  it('shows Weekly Hours & Rates beside Temporary Closures, and no legacy operating hours form', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Weekly Hours & Rates' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Temporary Closures' })).toBeInTheDocument()
    expect(await screen.findByRole('combobox', { name: 'Schedule for' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Operating hours' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save hours' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add blackout' })).toBeInTheDocument()
  })
})

describe('SchedulePage blackouts', () => {
  beforeEach(() => {
    // Fri 2030-01-04, 10:30 AM in Manila.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-01-04T02:30:00.000Z'))
    vi.mocked(fetchCourts).mockReset().mockResolvedValue([])
    vi.mocked(fetchUpcomingBlackouts).mockReset().mockResolvedValue([])
    vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila' } as VenueSettings)
    vi.mocked(fetchSchedule).mockReset()
    vi.mocked(createBlackout).mockReset().mockResolvedValue({} as Awaited<ReturnType<typeof createBlackout>>)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const group = (name: string) => within(screen.getByRole('group', { name }))

  it('adds a blackout from a date and hour to the end of a later day', async () => {
    renderPage()
    await userEvent.click(await group('Starts on').findByRole('button', { name: 'Tomorrow' }))
    await userEvent.click(group('Starts at').getByRole('radio', { name: '8 AM' }))
    // The end day follows the start day forward.
    expect(group('Ends on').getByRole('button', { name: 'Choose a date, Sat, Jan 5' })).toBeInTheDocument()
    expect(group('Ends on').getByRole('button', { name: 'Today' })).toBeDisabled()
    await userEvent.click(group('Ends at').getByRole('radio', { name: 'Midnight' }))
    await userEvent.type(screen.getByLabelText('Reason'), 'Floor maintenance')
    await userEvent.click(screen.getByRole('button', { name: 'Add blackout' }))
    expect(vi.mocked(createBlackout).mock.calls[0][0]).toEqual({
      court_id: null,
      starts_at: '2030-01-05T00:00:00.000Z', // 8 AM Sat
      ends_at: '2030-01-05T16:00:00.000Z', // midnight after Sat
      reason: 'Floor maintenance',
    })
  })

  it('offers the hour in progress but not ended ones, ends only after the start, and asks for both', async () => {
    renderPage()
    const starts = await screen.findByRole('group', { name: 'Starts at' })
    expect(within(starts).queryByRole('radio', { name: '9 AM' })).toBeNull()
    expect(within(starts).getByRole('radio', { name: '10 AM' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Add blackout' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose when the blackout starts.')

    await userEvent.click(within(starts).getByRole('radio', { name: '9 PM' }))
    expect(group('Ends at').getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['10 PM', '11 PM', 'Midnight'])
    await userEvent.click(screen.getByRole('button', { name: 'Add blackout' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose when it ends.')
    expect(createBlackout).not.toHaveBeenCalled()
  })
})
