// T17.16: copying hours/rates, impact warnings and revert in the Weekly Hours & Rates editor.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCourts, fetchVenueSettings, type CourtWithPhotos, type VenueSettings } from '../catalog/api'
import { fetchSchedule, saveSchedule } from './api'
import { WeeklyHoursEditor } from './WeeklyHoursEditor'

const previewMock = vi.hoisted(() => vi.fn())

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourts: vi.fn(),
  fetchVenueSettings: vi.fn(),
}))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSchedule: vi.fn(),
  saveSchedule: vi.fn(),
  previewScheduleImpact: previewMock,
}))

type Period = { day_of_week: number; start_minute: number; end_minute: number }
type Rate = { day_of_week: number; start_hour: number; price: number }
type Impact = {
  from: string; to: string
  bookings: { total: number; items: { booking_id: string; court_id: string; starts_at: string; ends_at: string; status: string }[] }
  open_play: { total: number; items: { session_id: string; court_id: string; title: string; starts_at: string; ends_at: string }[] }
}

const court = (id: string, name: string): CourtWithPhotos => ({
  id, name, sport: 'tennis', default_hourly_rate: 700, is_active: true, sort_order: 1, court_photos: [],
  venue_id: 'v1', description: '', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
})
const allDays = (start = 360, end = 1320): Period[] => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_minute: start, end_minute: end }))
const impact = (bookings: number, openPlay = 0, items = false): Impact => ({
  from: '2026-11-05', to: '2027-02-03',
  bookings: {
    total: bookings,
    items: items ? [{ booking_id: 'b1', court_id: 'c2', starts_at: '2026-11-10T00:00:00Z', ends_at: '2026-11-10T01:00:00Z', status: 'confirmed' }] : [],
  },
  open_play: { total: openPlay, items: [] },
})

function mount() {
  vi.mocked(fetchSchedule).mockResolvedValue({
    venue_id: 'v1',
    schedule_revision: 7,
    venue_periods: allDays(),
    courts: [
      { court_id: 'c1', schedule_mode: 'inherit', schedule_revision: 0, periods: [], rates: [] as Rate[] },
      { court_id: 'c2', schedule_mode: 'custom', schedule_revision: 0, periods: allDays(480, 1200), rates: [{ day_of_week: 1, start_hour: 18, price: 800 }] },
    ],
  } as never)
  vi.mocked(fetchCourts).mockResolvedValue([court('c1', 'Court One'), court('c2', 'Court Two')])
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([{ path: '/', element: <WeeklyHoursEditor /> }])
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}

const day = (name: string) => within(screen.getByRole('group', { name }))
const pick = async (label: string, value: string) => userEvent.selectOptions(await screen.findByLabelText(label), value)
const choose = async (name: string) => userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Schedule for' }), name)
const saveBtn = () => screen.getByRole('button', { name: 'Save schedule' })
const lastChanges = () => vi.mocked(saveSchedule).mock.calls.at(-1)![1] as Record<string, unknown[] | undefined>
const impactRegion = () => screen.getByRole('region', { name: 'Reservations outside the new hours' })

async function copyDay(from: string, to: string[], withRates = false) {
  await userEvent.click(await screen.findByRole('button', { name: `Copy ${from} hours` }))
  for (const d of to) await userEvent.click(screen.getByRole('checkbox', { name: d }))
  if (withRates) await userEvent.click(screen.getByRole('checkbox', { name: 'Also copy hourly rates' }))
  await userEvent.click(screen.getByRole('button', { name: 'Apply copy' }))
}

async function openCourtCopy(target: string, source: string, targetDay: string, withRates = false) {
  await userEvent.click(await screen.findByRole('button', { name: 'Copy to another court' }))
  await userEvent.selectOptions(screen.getByLabelText('Target court'), target)
  await userEvent.selectOptions(screen.getByLabelText('Source weekday'), source)
  await userEvent.selectOptions(screen.getByLabelText('Target weekday'), targetDay)
  if (withRates) await userEvent.click(screen.getByRole('checkbox', { name: 'Also copy hourly rates' }))
  await userEvent.click(screen.getByRole('button', { name: 'Review copy' }))
}

beforeEach(() => {
  previewMock.mockReset()
  previewMock.mockResolvedValue(impact(0))
  vi.mocked(fetchSchedule).mockReset()
  vi.mocked(saveSchedule).mockReset().mockResolvedValue({ venue_id: 'v1', schedule_revision: 8 } as never)
  vi.mocked(fetchCourts).mockReset()
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila' } as VenueSettings)
})

describe('copy hours within a schedule', () => {
  it('copies a weekday to chosen days on venue defaults, with no rates option', async () => {
    mount()
    await pick('Monday period 1 closes', '12')
    await userEvent.click(screen.getByRole('button', { name: 'Copy Monday hours' }))
    expect(screen.queryByRole('checkbox', { name: 'Also copy hourly rates' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Monday' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Tuesday' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Wednesday' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply copy' }))
    expect(day('Tuesday').getByLabelText('Tuesday period 1 closes')).toHaveValue('12')
    expect(day('Thursday').getByLabelText('Thursday period 1 closes')).toHaveValue('22')
    await userEvent.click(saveBtn())
    const periods = lastChanges().venue_periods as Period[]
    expect(periods.filter((p) => p.day_of_week === 1 || p.day_of_week === 2 || p.day_of_week === 3))
      .toEqual([1, 2, 3].map((d) => ({ day_of_week: d, start_minute: 360, end_minute: 720 })))
    expect(periods.filter((p) => p.day_of_week === 4)).toEqual([{ day_of_week: 4, start_minute: 360, end_minute: 1320 }])
  })

  it('a hours-only copy leaves the target days\' rate overrides untouched', async () => {
    mount()
    await choose('Court Two')
    await pick('Rate day', '2')
    await pick('Rate from', '9')
    await pick('Rate to', '10')
    await userEvent.type(screen.getByLabelText('Override price'), '500')
    await userEvent.click(screen.getByRole('button', { name: 'Apply rate' }))
    await pick('Monday period 1 closes', '12')
    await copyDay('Monday', ['Tuesday'])
    expect(day('Tuesday').getByLabelText('Tuesday period 1 closes')).toHaveValue('12')
    await userEvent.click(saveBtn())
    expect(lastChanges().rate_changes).toEqual([{ court_id: 'c2', day_of_week: 2, start_hour: 9, price: 500 }])
  })

  it('copying with rates replaces the target day\'s overrides with the source day\'s', async () => {
    mount()
    await choose('Court Two')
    await pick('Rate day', '2')
    await pick('Rate from', '9')
    await pick('Rate to', '10')
    await userEvent.type(screen.getByLabelText('Override price'), '500')
    await userEvent.click(screen.getByRole('button', { name: 'Apply rate' }))
    await copyDay('Monday', ['Tuesday'], true)
    expect(within(screen.getByRole('region', { name: 'Pending changes' })).getByText(/Court Two.*hourly rate/)).toBeInTheDocument()
    await userEvent.click(saveBtn())
    // Tuesday's own 9 AM override had no saved value, so only the Monday 6 PM override arrives
    expect(lastChanges().rate_changes).toEqual([{ court_id: 'c2', day_of_week: 2, start_hour: 18, price: 800 }])
  })

  it('copying with rates clears a saved target override the source does not have', async () => {
    mount()
    await choose('Court Two')
    // Tuesday (source) has no overrides; Monday (target) has a saved 6 PM 800
    await copyDay('Tuesday', ['Monday'], true)
    await userEvent.click(saveBtn())
    expect(lastChanges().rate_changes).toEqual([{ court_id: 'c2', day_of_week: 1, start_hour: 18, price: null }])
  })

  it('a court on venue hours cannot copy until Custom hours is chosen', async () => {
    mount()
    await choose('Court One')
    const before = screen.queryByRole('button', { name: 'Copy Monday hours' })
    if (before) expect(before).toBeDisabled()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Court hours' }), 'Custom hours')
    expect(screen.getByRole('button', { name: 'Copy Monday hours' })).toBeEnabled()
  })
})

describe('copy to another court', () => {
  it('asks to confirm, warns about overwrite and custom hours, and changes nothing until confirmed', async () => {
    mount()
    await choose('Court Two')
    await openCourtCopy('Court One', 'Monday', 'Tuesday')
    const dialog = await screen.findByRole('dialog', { name: 'Copy to Court One' })
    expect(dialog).toHaveTextContent(/overwrite/i)
    expect(dialog).toHaveTextContent(/custom hours/i)
    expect(saveBtn()).toBeDisabled()
    expect(screen.queryByRole('region', { name: 'Pending changes' })).not.toBeInTheDocument()
  })

  it('cancelling leaves the whole draft unchanged', async () => {
    mount()
    await choose('Court Two')
    await openCourtCopy('Court One', 'Monday', 'Tuesday')
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Copy to Court One' })).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Copy to Court One' })).not.toBeInTheDocument()
    expect(saveBtn()).toBeDisabled()
    expect(screen.queryByRole('region', { name: 'Pending changes' })).not.toBeInTheDocument()
    expect(screen.queryByText('You have unsaved changes.')).not.toBeInTheDocument()
    await choose('Court One')
    expect(screen.getByRole('combobox', { name: 'Court hours' })).toHaveDisplayValue('Use venue hours')
    expect(saveSchedule).not.toHaveBeenCalled()
  })

  it('confirming makes the target custom, seeded from venue hours, with only the chosen day replaced', async () => {
    mount()
    await choose('Court Two')
    await openCourtCopy('Court One', 'Monday', 'Tuesday')
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Copy to Court One' })).getByRole('button', { name: 'Copy to Court One' }))
    await userEvent.click(saveBtn())
    expect(saveSchedule).toHaveBeenCalledWith(7, {
      courts: [{
        court_id: 'c1', schedule_mode: 'custom',
        periods: allDays().map((p) => (p.day_of_week === 2 ? { ...p, start_minute: 480, end_minute: 1200 } : p)),
      }],
    })
  })

  it('rates travel only when asked', async () => {
    mount()
    await choose('Court Two')
    await openCourtCopy('Court One', 'Monday', 'Tuesday', true)
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Copy to Court One' })).getByRole('button', { name: 'Copy to Court One' }))
    await userEvent.click(saveBtn())
    expect(lastChanges().rate_changes).toEqual([{ court_id: 'c1', day_of_week: 2, start_hour: 18, price: 800 }])
  })

  it('is not offered while Venue defaults is selected', async () => {
    mount()
    await screen.findByRole('combobox', { name: 'Schedule for' })
    expect(screen.queryByRole('button', { name: 'Copy to another court' })).not.toBeInTheDocument()
  })
})

describe('revert unsaved changes', () => {
  it('is hidden when clean; Keep editing keeps the draft; confirming restores the loaded schedule', async () => {
    mount()
    await screen.findByRole('combobox', { name: 'Schedule for' })
    expect(screen.queryByRole('button', { name: 'Revert unsaved changes' })).not.toBeInTheDocument()
    await pick('Monday period 1 closes', '12')
    await userEvent.click(screen.getByRole('button', { name: 'Revert unsaved changes' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Revert unsaved changes' })).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Monday period 1 closes')).toHaveValue('12')
    await userEvent.click(screen.getByRole('button', { name: 'Revert unsaved changes' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Revert unsaved changes' })).getByRole('button', { name: 'Revert' }))
    expect(screen.getByLabelText('Monday period 1 closes')).toHaveValue('22')
    expect(screen.queryByText('You have unsaved changes.')).not.toBeInTheDocument()
    expect(saveBtn()).toBeDisabled()
    expect(saveSchedule).not.toHaveBeenCalled()
  })
})

describe('impact warning', () => {
  it('does not preview a clean draft or one with overlaps', async () => {
    mount()
    await screen.findByRole('combobox', { name: 'Schedule for' })
    expect(previewMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Reservations outside the new hours' })).not.toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('group', { name: 'Monday' })).getByRole('button', { name: 'Add Monday period' }))
    await pick('Monday period 2 opens', '10')
    expect(day('Monday').getByRole('alert')).toHaveTextContent(/overlap/i)
    expect(screen.queryByRole('region', { name: 'Reservations outside the new hours' })).not.toBeInTheDocument()
  })

  it('previews the whole draft over at most 90 days and lists totals and items', async () => {
    previewMock.mockResolvedValue({
      ...impact(3, 2, true),
      open_play: { total: 2, items: [{ session_id: 's1', court_id: 'c1', title: 'Friday Rally', starts_at: '2026-11-11T10:00:00Z', ends_at: '2026-11-11T12:00:00Z' }] },
    })
    mount()
    await pick('Monday period 1 closes', '12')
    const region = await screen.findByRole('region', { name: 'Reservations outside the new hours' })
    await waitFor(() => expect(within(region).getByText(/3 bookings/)).toBeInTheDocument())
    expect(within(region).getByText(/2 open play/)).toBeInTheDocument()
    expect(region).toHaveTextContent('Court Two')
    expect(region).toHaveTextContent(/confirmed/i)
    expect(region).toHaveTextContent('Friday Rally')
    const [draft, from, to] = previewMock.mock.calls.at(-1)!
    expect(draft.venue_periods.filter((p: Period) => p.day_of_week === 1)).toEqual([{ day_of_week: 1, start_minute: 360, end_minute: 720 }])
    expect(draft.courts.map((c: { court_id: string }) => c.court_id)).toEqual(['c1', 'c2'])
    expect(draft.courts.map((c: { schedule_mode: string }) => c.schedule_mode)).toEqual(['inherit', 'custom'])
    expect(draft.courts[1].periods).toHaveLength(7)
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000
    expect(days).toBeGreaterThan(0)
    expect(days).toBeLessThanOrEqual(91)
  })

  it('says nothing is affected for a zero result', async () => {
    mount()
    await pick('Monday period 1 closes', '12')
    expect(await screen.findByText('No existing reservations are affected')).toBeInTheDocument()
  })

  it('a pending preview does not block Save', async () => {
    previewMock.mockReturnValue(new Promise(() => {}))
    mount()
    await pick('Monday period 1 closes', '12')
    expect(impactRegion()).toHaveTextContent(/checking/i)
    expect(saveBtn()).toBeEnabled()
    await userEvent.click(saveBtn())
    expect(saveSchedule).toHaveBeenCalledTimes(1)
  })

  it('a failed preview is quiet, retryable, and does not block Save', async () => {
    previewMock.mockRejectedValueOnce(new Error('boom'))
    previewMock.mockResolvedValue(impact(4))
    mount()
    await pick('Monday period 1 closes', '12')
    expect(await screen.findByText(/Couldn't check existing reservations/)).toBeInTheDocument()
    expect(saveBtn()).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/4 bookings/)).toBeInTheDocument()
  })

  it('a result with affected reservations still lets the admin save', async () => {
    previewMock.mockResolvedValue(impact(5, 0, true))
    mount()
    await pick('Monday period 1 closes', '12')
    await screen.findByText(/5 bookings/)
    expect(saveBtn()).toBeEnabled()
    await userEvent.click(saveBtn())
    expect(saveSchedule).toHaveBeenCalledTimes(1)
  })

  it('never shows a previous draft\'s result for the current draft', async () => {
    let resolveSlow: (v: Impact) => void = () => {}
    previewMock.mockImplementation(async (draft: { venue_periods: Period[] }) => {
      const monday = draft.venue_periods.find((p) => p.day_of_week === 1)!
      if (monday.end_minute === 720) return impact(7)
      return new Promise<Impact>((resolve) => { resolveSlow = resolve })
    })
    mount()
    await pick('Monday period 1 closes', '12')
    expect(await screen.findByText(/7 bookings/)).toBeInTheDocument()
    await pick('Monday period 1 closes', '14')
    // the new draft's preview is pending: the old 7 must be gone
    await waitFor(() => expect(screen.queryByText(/7 bookings/)).not.toBeInTheDocument())
    expect(saveBtn()).toBeEnabled()
    resolveSlow(impact(9))
    expect(await screen.findByText(/9 bookings/)).toBeInTheDocument()
  })

  it('a late answer for an older draft is ignored', async () => {
    const resolvers: Record<number, (v: Impact) => void> = {}
    previewMock.mockImplementation((draft: { venue_periods: Period[] }) =>
      new Promise<Impact>((resolve) => { resolvers[draft.venue_periods.find((p) => p.day_of_week === 1)!.end_minute] = resolve }))
    mount()
    await pick('Monday period 1 closes', '12')
    await waitFor(() => expect(resolvers[720]).toBeDefined())
    await pick('Monday period 1 closes', '14')
    await waitFor(() => expect(resolvers[840]).toBeDefined())
    resolvers[840](impact(6))
    expect(await screen.findByText(/6 bookings/)).toBeInTheDocument()
    resolvers[720](impact(8))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/8 bookings/)).not.toBeInTheDocument()
    expect(screen.getByText(/6 bookings/)).toBeInTheDocument()
  })
})
