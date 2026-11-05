import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OpenPlayPage } from './OpenPlayPage'

const h = vi.hoisted(() => ({ staff: vi.fn() }))
vi.mock('../catalog/api', async (original) => ({
  ...(await original<object>()),
  fetchCourts: vi.fn(async () => [{ id: 'A', name: 'Court A', sport: 'tennis', is_active: true, court_photos: [] }]),
  fetchOperatingHours: vi.fn(async () => [0, 1, 2, 3, 4, 5, 6].map((day_of_week) => ({ day_of_week, open_time: '06:00', close_time: '22:00', is_closed: false }))),
  fetchVenueSettings: vi.fn(async () => ({ timezone: 'Asia/Manila' })),
  fetchStaffSchedule: h.staff,
}))
vi.mock('../openPlay/api', async (original) => ({ ...(await original<object>()), fetchUpcomingOpenPlay: vi.fn(async () => []) }))
vi.mock('../booking/useNow', () => ({ useNow: () => new Date('2030-01-07T00:00:00.000Z') }))
vi.mock('../venue/useVenue', () => ({ useVenue: () => ({ id: 'venue-a', slug: 'a-venue', status: 'active' }) }))

describe('open play effective periods', () => {
  it('offers only selected-court times and does not allow a duration past a touching boundary', async () => {
    h.staff.mockResolvedValue([
      { court_id: 'A', operating_date: '2030-01-07', period_start: '2030-01-07T02:00:00Z', period_end: '2030-01-07T04:00:00Z' },
      { court_id: 'A', operating_date: '2030-01-07', period_start: '2030-01-07T04:00:00Z', period_end: '2030-01-07T05:00:00Z' },
      { court_id: 'A', operating_date: '2030-01-07', period_start: '2030-01-07T06:00:00Z', period_end: '2030-01-07T08:00:00Z' },
    ])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><OpenPlayPage /></QueryClientProvider>)
    const form = await screen.findByRole('form', { name: 'Open play session' })
    await userEvent.click(within(form).getByRole('checkbox', { name: /Court A/ }))
    const starts = within(form).getByRole('group', { name: 'Starts' })
    expect(within(starts).queryByRole('radio', { name: /^1 PM$/ })).not.toBeInTheDocument()
    await userEvent.click(await within(starts).findByRole('radio', { name: /^11 AM$/ }))
    const duration = within(form).getByRole('group', { name: 'How long' })
    expect(within(duration).getByRole('radio', { name: '1 hr' })).toBeInTheDocument()
    expect(within(duration).queryByRole('radio', { name: '2 hrs' })).not.toBeInTheDocument()
  })
})
