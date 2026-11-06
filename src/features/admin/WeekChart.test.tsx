// T17.32: "Week at a glance", the live chart of the week being edited. Every day also has a text description for screen
// readers (chartDayText). Position, stripes and the fitted axis are visual and are checked in the e2e screenshot review.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCourts, fetchUpcomingBlackouts, fetchVenueSettings, type CourtWithPhotos, type VenueSettings } from '../catalog/api'
import { fetchSchedule, type ScheduleData, type SchedulePeriod } from './api'
import { SchedulePage } from './SchedulePage'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourts: vi.fn(),
  fetchUpcomingBlackouts: vi.fn(),
  fetchVenueSettings: vi.fn(),
}))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSchedule: vi.fn(),
  saveSchedule: vi.fn(),
  previewScheduleImpact: vi.fn(),
}))

const p = (day: number, startHour: number, endHour: number): SchedulePeriod => ({ day_of_week: day, start_minute: startHour * 60, end_minute: endHour * 60 })
const week = (): SchedulePeriod[] => [0, 1, 2, 3, 4, 5, 6].map((d) => p(d, 6, 22))
const court = (id: string, name: string): CourtWithPhotos => ({
  id, name, sport: 'tennis', default_hourly_rate: 700, is_active: true, sort_order: 1, court_photos: [],
  venue_id: 'v1', description: '', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
})

function mount(venue: SchedulePeriod[] = week(), courtPeriods: SchedulePeriod[] | null = null) {
  const data: ScheduleData = {
    venue_id: 'v1',
    schedule_revision: 7,
    venue_periods: venue,
    courts: [{ court_id: 'c1', schedule_mode: courtPeriods ? 'custom' : 'inherit', schedule_revision: 0, periods: courtPeriods ?? [], rates: [] }],
  }
  vi.mocked(fetchSchedule).mockResolvedValue(data)
  vi.mocked(fetchCourts).mockResolvedValue([court('c1', 'Court One')])
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([{ path: '/admin/schedule', element: <SchedulePage /> }], { initialEntries: ['/admin/schedule'] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}
const chart = async () => within(await screen.findByRole('region', { name: 'Week at a glance' }))

beforeEach(() => {
  vi.mocked(fetchUpcomingBlackouts).mockReset().mockResolvedValue([])
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila' } as VenueSettings)
  vi.mocked(fetchSchedule).mockReset()
  vi.mocked(fetchCourts).mockReset()
})

describe('the text description of each day', () => {
  it('describes all seven days, Monday first', async () => {
    mount()
    const c = await chart()
    for (const name of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      expect(c.getByText(`${name}: open 6 AM to 10 PM`)).toBeInTheDocument()
    }
    const texts = c.getAllByText(/^\w+day: /).map((el) => el.textContent?.split(':')[0])
    expect(texts).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
  })

  it('says closed for a closed day', async () => {
    mount(week().filter((x) => x.day_of_week !== 3))
    expect((await chart()).getByText('Wednesday: closed')).toBeInTheDocument()
  })

  it('names both ranges around a break', async () => {
    mount([...week().filter((x) => x.day_of_week !== 1), p(1, 6, 12), p(1, 14, 22)])
    expect((await chart()).getByText('Monday: open 6 AM to 12 PM and 2 PM to 10 PM')).toBeInTheDocument()
  })

  it('lists several breaks with commas and a last "and"', async () => {
    mount([...week().filter((x) => x.day_of_week !== 1), p(1, 6, 10), p(1, 12, 14), p(1, 16, 22)])
    expect((await chart()).getByText('Monday: open 6 AM to 10 AM, 12 PM to 2 PM and 4 PM to 10 PM')).toBeInTheDocument()
  })

  it('marks an after-midnight close (next day), and a close at midnight', async () => {
    mount([...week().filter((x) => x.day_of_week !== 5 && x.day_of_week !== 6), p(5, 22, 26), p(6, 10, 24)])
    const c = await chart()
    expect(c.getByText('Friday: open 10 PM to 2 AM (next day)')).toBeInTheDocument()
    expect(c.getByText('Saturday: open 10 AM to Midnight')).toBeInTheDocument()
  })

  it('says 24 hours for 12 AM to Midnight', async () => {
    mount([...week().filter((x) => x.day_of_week !== 0), p(0, 0, 24)])
    expect((await chart()).getByText('Sunday: open 24 hours')).toBeInTheDocument()
  })
})

describe('live with the edits', () => {
  it('follows the table as it is edited: a close time, a break, the switch', async () => {
    mount()
    const c = await chart()
    await userEvent.selectOptions(screen.getByLabelText('Monday closes'), '12')
    expect(c.getByText('Monday: open 6 AM to 12 PM')).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('group', { name: 'Tuesday' })).getByRole('button', { name: /Add a break/ }))
    expect(c.getByText('Tuesday: open 6 AM to 12 PM and 2 PM to 10 PM')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch', { name: 'Wednesday open' }))
    expect(c.getByText('Wednesday: closed')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Friday closes'), '26')
    expect(c.getByText('Friday: open 6 AM to 2 AM (next day)')).toBeInTheDocument()
  })

  it('shows the court being edited, and the venue again after Back to all courts', async () => {
    mount(week(), week().map((x) => ({ ...x, start_minute: 480, end_minute: 1200 })))
    const c = await chart()
    expect(c.getByText('Monday: open 6 AM to 10 PM')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Edit hours for Court One/ }))
    expect(c.getByText('Monday: open 8 AM to 8 PM')).toBeInTheDocument()
    expect(c.queryByText('Monday: open 6 AM to 10 PM')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to all courts' }))
    expect(c.getByText('Monday: open 6 AM to 10 PM')).toBeInTheDocument()
  })
})
