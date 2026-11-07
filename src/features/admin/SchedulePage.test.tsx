import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { createBlackout, fetchCourts, fetchUpcomingBlackouts, fetchVenueSettings, type VenueSettings } from '../catalog/api'
import { fetchClosureConflicts, fetchSchedule } from './api'
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
  fetchClosureConflicts: vi.fn(),
}))

const emptySchedule = {
  venue_id: 'v1',
  schedule_revision: 0,
  venue_periods: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_minute: 360, end_minute: 1320 })),
  courts: [{ court_id: 'c1', schedule_mode: 'inherit', schedule_revision: 0, periods: [], rates: [] }],
}

/** The Closures tab holds the closures panel (T17.31, T17.33): `?tab=closures`. */
function renderPage(tab = 'closures') {
  vi.mocked(fetchSchedule).mockResolvedValue(emptySchedule as never)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([{ path: '/admin/schedule', element: <SchedulePage /> }], { initialEntries: [`/admin/schedule?tab=${tab}`] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}

describe('SchedulePage sections (T17.15, T17.33)', () => {
  beforeEach(() => {
    vi.mocked(fetchCourts).mockReset().mockResolvedValue([])
    vi.mocked(fetchUpcomingBlackouts).mockReset().mockResolvedValue([])
    vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila' } as VenueSettings)
    vi.mocked(fetchSchedule).mockReset()
  })

  it('shows the hours editor in Opening hours and the closures panel in Closures, with no legacy operating hours form', async () => {
    renderPage('hours')
    expect(await screen.findByRole('switch', { name: 'Monday open' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Weekly Hours & Rates' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Operating hours' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save hours' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add closure' })).not.toBeInTheDocument() // the Closures panel is hidden
    await userEvent.click(screen.getByRole('tab', { name: 'Closures' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Closures' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Temporary Closures' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add closure' })).toBeInTheDocument()
  })
})

describe('SchedulePage closures', () => {
  beforeEach(() => {
    // Fri 2030-01-04, 10:30 AM in Manila.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-01-04T02:30:00.000Z'))
    vi.mocked(fetchCourts).mockReset().mockResolvedValue([])
    vi.mocked(fetchUpcomingBlackouts).mockReset().mockResolvedValue([])
    vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila' } as VenueSettings)
    vi.mocked(fetchSchedule).mockReset()
    vi.mocked(fetchClosureConflicts).mockReset().mockResolvedValue({ bookings: [], sessions: [] })
    vi.mocked(createBlackout).mockReset().mockResolvedValue({} as Awaited<ReturnType<typeof createBlackout>>)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const group = (name: string) => within(screen.getByRole('group', { name }))

  it('adds a timed closure from a start hour to the end of the day, with the staff note', async () => {
    renderPage()
    await userEvent.click(await group('Which days').findByRole('button', { name: 'Tomorrow' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'All day' }))
    await userEvent.click(group('Starts at').getByRole('radio', { name: '8 AM' }))
    await userEvent.click(group('Ends at').getByRole('radio', { name: 'Midnight' }))
    await userEvent.type(screen.getByLabelText('Reason (staff only)'), 'Floor maintenance')
    await userEvent.click(screen.getByRole('button', { name: 'Add closure' }))
    expect(vi.mocked(createBlackout).mock.calls[0][0]).toEqual({
      court_id: null,
      starts_at: '2030-01-05T00:00:00.000Z', // 8 AM Sat
      ends_at: '2030-01-05T16:00:00.000Z', // midnight after Sat
      reason: 'Floor maintenance',
    })
  })

  it('closes the whole operating day by default (6 AM to 10 PM)', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Add closure' }))
    await vi.waitFor(() => expect(createBlackout).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createBlackout).mock.calls[0][0]).toEqual({
      court_id: null,
      starts_at: '2030-01-03T22:00:00.000Z',
      ends_at: '2030-01-04T14:00:00.000Z',
      reason: '',
    })
  })

  it('offers the hour in progress but not ended ones, ends only after the start, and asks for both', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'All day' }))
    const starts = screen.getByRole('group', { name: 'Starts at' })
    expect(within(starts).queryByRole('radio', { name: '9 AM' })).toBeNull()
    expect(within(starts).getByRole('radio', { name: '10 AM' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Add closure' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose when the closure starts.')

    await userEvent.click(within(starts).getByRole('radio', { name: '9 PM' }))
    expect(group('Ends at').getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['10 PM', '11 PM', 'Midnight'])
    await userEvent.click(screen.getByRole('button', { name: 'Add closure' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose when it ends.')
    expect(createBlackout).not.toHaveBeenCalled()
  })
})
