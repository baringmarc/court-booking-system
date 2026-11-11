// Shared fixtures and helpers for the ScheduleReview tests (split in two files for H12: one file took over 15 s under load).
// The test files own the vi.mock calls for './api' and '../catalog/api'; this module only uses the mocked functions.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import baseUserEvent from '@testing-library/user-event'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
import { beforeEach, vi } from 'vitest'
import { fetchCourts, fetchUpcomingBlackouts, fetchVenueSettings, type CourtWithPhotos, type VenueSettings } from '../catalog/api'
import { fetchSchedule, previewScheduleImpact, saveSchedule } from './api'
import { SchedulePage } from './SchedulePage'

// No per-action macrotask delay (H12): the real-timer waits dominated these files' runtime.
export const userEvent = baseUserEvent.setup({ delay: null })

export type Period = { day_of_week: number; start_minute: number; end_minute: number }
export type Rate = { day_of_week: number; start_hour: number; price: number }
export type Impact = {
  from: string; to: string
  bookings: { total: number; items: { booking_id: string; court_id: string; starts_at: string; ends_at: string; status: string }[] }
  open_play: { total: number; items: { session_id: string; court_id: string; title: string; starts_at: string; ends_at: string }[] }
}

export const TZ = 'Asia/Manila'
export const court = (id: string, name: string): CourtWithPhotos => ({
  id, name, sport: 'tennis', default_hourly_rate: 700, is_active: true, sort_order: 1, court_photos: [],
  venue_id: 'v1', description: '', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
})
export const allDays = (start = 360, end = 1320): Period[] => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_minute: start, end_minute: end }))
export const noImpact = (): Impact => ({ from: '2026-11-05', to: '2027-02-03', bookings: { total: 0, items: [] }, open_play: { total: 0, items: [] } })

export function scheduleData(over: { revision?: number; venue?: Period[] } = {}) {
  return {
    venue_id: 'v1',
    schedule_revision: over.revision ?? 7,
    venue_periods: over.venue ?? allDays(),
    courts: [
      { court_id: 'c1', schedule_mode: 'inherit', schedule_revision: 0, periods: [], rates: [] as Rate[] },
      { court_id: 'c2', schedule_mode: 'custom', schedule_revision: 0, periods: allDays(480, 1200), rates: [{ day_of_week: 1, start_hour: 18, price: 800 }] },
    ],
  }
}

export function mount(entry = '/admin/schedule') {
  vi.mocked(fetchSchedule).mockResolvedValue(scheduleData() as never)
  vi.mocked(fetchCourts).mockResolvedValue([court('c1', 'Court One'), court('c2', 'Court Two')])
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([
    { path: '/admin/schedule', element: <><Link to="/elsewhere">Elsewhere</Link><SchedulePage /></> },
    { path: '/elsewhere', element: <p>Elsewhere page</p> },
  ], { initialEntries: [entry] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

export const HOURS = /^Opening hours/
export const PRICES = /^Prices/
export const CLOSURES = /^Closures/
export const openTab = async (name: RegExp) => userEvent.click(await screen.findByRole('tab', { name }))
export const pick = async (label: string, value: string) => userEvent.selectOptions(await screen.findByLabelText(label), value)
/** Opens a court's own-hours view ("Editing Court N only"); Back to all courts returns to the venue's table. */
export const editCourt = async (name: string) => userEvent.click(await within(await screen.findByRole('region', { name: 'Courts with different hours' })).findByRole('button', { name: new RegExp(`^Edit hours for ${name}`) }))
export const backToAll = async () => userEvent.click(await screen.findByRole('button', { name: 'Back to all courts' }))
/** Gives a court on the opening hours its own hours (a copy of the venue's); this opens its edit view. */
export const giveHours = async (name: string) => {
  await userEvent.selectOptions(await screen.findByLabelText('Choose a court'), name)
  await userEvent.click(screen.getByRole('button', { name: 'Give this court different hours' }))
}
export const addBreak = async (day: string) => userEvent.click(within(await screen.findByRole('group', { name: day })).getByRole('button', { name: /Add a break/ }))
export const bar = () => screen.queryByRole('region', { name: 'Unsaved changes' })
export const barButton = (name: string) => within(screen.getByRole('region', { name: 'Unsaved changes' })).getByRole('button', { name })
export const reviewDialog = () => screen.findByRole('dialog', { name: 'Review changes' })
export const openReview = async () => {
  await userEvent.click(barButton('Review & save'))
  return reviewDialog()
}
export const lines = (dialog: HTMLElement) => within(dialog).getAllByRole('listitem').map((li) => li.textContent)
export const saveFromDialog = async () => {
  await userEvent.click(within(await openReview()).getByRole('button', { name: 'Save changes' }))
}
export const lastChanges = () => vi.mocked(saveSchedule).mock.calls.at(-1)![1] as Record<string, unknown[] | undefined>

/** Venue Monday 6 AM – 10 PM becomes 6 AM – 12 PM: one hours change. */
export const editMonday = async () => pick('Monday closes', '12')
/** A new override for Court Two on Monday 6 AM – 7 AM. */
export async function addRate(price: string, from = '6', to = '7') {
  await openTab(PRICES)
  await pick('Prices for', 'c2')
  await pick('Rate day', '1')
  await pick('Rate from', from)
  await pick('Rate to', to)
  const input = screen.getByLabelText('Override price')
  await userEvent.clear(input)
  if (price) await userEvent.type(input, price)
  await userEvent.click(screen.getByRole('button', { name: 'Apply rate' }))
}

beforeEach(() => {
  vi.mocked(previewScheduleImpact).mockReset()
  vi.mocked(previewScheduleImpact).mockResolvedValue(noImpact())
  vi.mocked(fetchSchedule).mockReset()
  vi.mocked(saveSchedule).mockReset().mockResolvedValue({ venue_id: 'v1', schedule_revision: 8 } as never)
  vi.mocked(fetchCourts).mockReset()
  vi.mocked(fetchUpcomingBlackouts).mockReset().mockResolvedValue([])
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: TZ } as VenueSettings)
})
