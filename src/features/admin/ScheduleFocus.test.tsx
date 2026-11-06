// T17.31 (builder's edge cases): the save bar leaves once a save or Discard makes the draft clean, so focus returns to
// the open tab instead of falling to the page body.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { fetchCourts, fetchUpcomingBlackouts, fetchVenueSettings, type VenueSettings } from '../catalog/api'
import { fetchSchedule, previewScheduleImpact, saveSchedule } from './api'
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

const week = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_minute: 360, end_minute: 1320 }))

beforeEach(() => {
  vi.mocked(fetchSchedule).mockReset().mockResolvedValue({ venue_id: 'v1', schedule_revision: 7, venue_periods: week, courts: [] } as never)
  vi.mocked(fetchCourts).mockReset().mockResolvedValue([])
  vi.mocked(fetchUpcomingBlackouts).mockReset().mockResolvedValue([])
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila' } as VenueSettings)
  vi.mocked(saveSchedule).mockReset().mockResolvedValue({ venue_id: 'v1', schedule_revision: 8 } as never)
  vi.mocked(previewScheduleImpact).mockReset().mockResolvedValue(
    { from: '', to: '', bookings: { total: 0, items: [] }, open_play: { total: 0, items: [] } })
})

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([{ path: '/admin/schedule', element: <SchedulePage /> }], { initialEntries: ['/admin/schedule'] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}

const bar = () => within(screen.getByRole('region', { name: 'Unsaved changes' }))

it('returns focus to the open tab after a confirmed Discard', async () => {
  mount()
  await userEvent.selectOptions(await screen.findByLabelText('Monday period 1 closes'), '12')
  await userEvent.click(bar().getByRole('button', { name: 'Discard' }))
  await userEvent.click(within(await screen.findByRole('dialog', { name: 'Discard changes' })).getByRole('button', { name: 'Discard' }))
  expect(screen.getByRole('tab', { name: 'Opening hours' })).toHaveFocus()
})

it('returns focus to the open tab after a successful save', async () => {
  mount()
  await userEvent.selectOptions(await screen.findByLabelText('Monday period 1 closes'), '12')
  await userEvent.click(bar().getByRole('button', { name: 'Review & save' }))
  await userEvent.click(within(await screen.findByRole('dialog', { name: 'Review changes' })).getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument())
  expect(screen.getByRole('tab', { name: 'Opening hours' })).toHaveFocus()
})
