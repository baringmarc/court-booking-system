import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { addDays, todayInZone } from '../../lib/time'
import { dowOf } from '../catalog/hours'
import { BookPage } from './BookPage'

const mocks = vi.hoisted(() => ({ schedule: vi.fn(), availability: vi.fn() }))
const tomorrow = addDays(todayInZone('Asia/Manila'), 1)
const instant = (date: string, hour: number) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+08:00`).toISOString()
vi.mock('../catalog/hooks', () => ({
  useVenueSettings: () => ({ data: { timezone: 'Asia/Manila', currency: 'PHP', booking_window_days: 30 }, isPending: false }),
  useCourts: () => ({ data: [{ id: 'A', name: 'Court A', sport: 'tennis', is_active: true, court_photos: [] }], isPending: false }),
  useOperatingHours: () => ({ data: Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, open_time: '06:00:00', close_time: '22:00:00', is_closed: day_of_week === dowOf(tomorrow) })), isPending: false }),
  usePublicSchedule: mocks.schedule,
}))
vi.mock('./hooks', () => ({ useAvailability: mocks.availability }))
vi.mock('../openPlay/hooks', () => ({ useUpcomingOpenPlay: () => ({ data: [] }) }))

describe('BookPage effective schedules', () => {
  it('allows navigation to a day opened only by a custom court', async () => {
    mocks.schedule.mockReturnValue({ isPending: false, data: [{ court_id: 'A', operating_date: tomorrow,
      period_start: instant(tomorrow, 6), period_end: instant(tomorrow, 10),
      booking_start: todayInZone('Asia/Manila'), booking_end: addDays(tomorrow, 29) }] })
    mocks.availability.mockReturnValue({ isPending: false, data: [] })
    render(<MemoryRouter initialEntries={['/book']}><BookPage /></MemoryRouter>)
    const dates = await screen.findByRole('group', { name: 'Date' })
    const tomorrowTile = within(dates).getAllByRole('button').filter((button) => button.classList.contains('date-tile'))[1]
    expect(tomorrowTile).toBeEnabled()
    await userEvent.click(tomorrowTile)
    expect(tomorrowTile).toHaveAttribute('aria-pressed', 'true')
  })
})
