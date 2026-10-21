import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import {
  fetchCourts, fetchOperatingHours, fetchUpcomingBlackouts, fetchVenueSettings, saveOperatingHours,
  type OperatingHours, type VenueSettings,
} from '../catalog/api'
import { SchedulePage } from './SchedulePage'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourts: vi.fn(),
  fetchOperatingHours: vi.fn(),
  fetchUpcomingBlackouts: vi.fn(),
  fetchVenueSettings: vi.fn(),
  saveOperatingHours: vi.fn(),
}))

const week = (patch: Partial<Record<number, Partial<OperatingHours>>> = {}): OperatingHours[] =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '06:00:00', close_time: '22:00:00', is_closed: false, ...patch[d] }))

function renderPage(hours = week()) {
  vi.mocked(fetchOperatingHours).mockResolvedValue(hours)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><SchedulePage /></QueryClientProvider>)
}

describe('SchedulePage operating hours', () => {
  beforeEach(() => {
    vi.mocked(fetchCourts).mockReset().mockResolvedValue([])
    vi.mocked(fetchUpcomingBlackouts).mockReset().mockResolvedValue([])
    vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila' } as VenueSettings)
    vi.mocked(saveOperatingHours).mockReset().mockResolvedValue()
  })

  it('says a close before the open is the next day, and saves it', async () => {
    renderPage()
    await userEvent.selectOptions(await screen.findByLabelText('Monday closes'), '5')
    expect(screen.getByText('closes next day')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save hours' }))
    const saved = vi.mocked(saveOperatingHours).mock.calls[0][0]
    expect(saved.find((r) => r.day_of_week === 1)).toMatchObject({ open_time: '06:00:00', close_time: '05:00' })
  })

  it('has an "Open 24 hours" switch per day that closes at the opening time', async () => {
    renderPage()
    const allDay = await screen.findByLabelText('Monday open 24 hours')
    await userEvent.click(allDay)
    expect(screen.getByLabelText('Monday closes')).toBeDisabled()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('6')
    expect(screen.queryByText('closes next day')).not.toBeInTheDocument()
    await userEvent.click(allDay)
    expect(screen.getByLabelText('Monday closes')).toHaveValue('22')
  })

  it('stops a day running into the next day\'s opening before saving', async () => {
    renderPage(week({ 1: { open_time: '08:00:00', close_time: '06:00:00' } }))
    expect(await screen.findByText('closes next day')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Monday closes'), '7')
    expect(screen.getByRole('alert')).toHaveTextContent("Monday runs past Tuesday's opening time.")
    expect(screen.getByRole('button', { name: 'Save hours' })).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText('Tuesday opens'), '7')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save hours' })).toBeEnabled()
  })

  it('shows the server\'s answer when saving fails', async () => {
    vi.mocked(saveOperatingHours).mockRejectedValue(
      new ApiError("Sunday runs past Monday's opening time. Close earlier, or open Monday later.", 'P0001', 'hours_overlap'),
    )
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Save hours' }))
    expect(await screen.findByText(/Sunday runs past Monday's opening time/)).toBeInTheDocument()
  })
})
