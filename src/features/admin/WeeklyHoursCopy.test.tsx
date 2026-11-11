// T17.16 / T17.31 / T17.32: the copy row (the days of the table being edited), the impact warning (in the Review changes dialog) and Discard.
// Copying hours between courts is "Copy hours from [court]" (CourtExceptions.test.tsx); hourly rates are no longer copied with hours.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import baseUserEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCourts, fetchUpcomingBlackouts, fetchVenueSettings, type CourtWithPhotos, type VenueSettings } from '../catalog/api'
import { fetchSchedule, saveSchedule } from './api'
import { SchedulePage } from './SchedulePage'

// No per-action macrotask delay (H12): the real-timer waits dominated this file's runtime.
const userEvent = baseUserEvent.setup({ delay: null })

const previewMock = vi.hoisted(() => vi.fn())

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
  const router = createMemoryRouter([{ path: '/admin/schedule', element: <SchedulePage /> }], { initialEntries: ['/admin/schedule'] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}

const day = (name: string) => within(screen.getByRole('group', { name }))
const pick = async (label: string, value: string) => userEvent.selectOptions(await screen.findByLabelText(label), value)
const ready = () => screen.findByRole('switch', { name: 'Monday open' })
const editCourt = async (name: string) => userEvent.click(await within(await screen.findByRole('region', { name: 'Courts with different hours' })).findByRole('button', { name: `Edit hours for ${name}` }))
const HOURS = /^Opening hours/
const PRICES = /^Prices/
const openTab = async (name: RegExp) => userEvent.click(await screen.findByRole('tab', { name }))
const bar = () => screen.queryByRole('region', { name: 'Unsaved changes' })
const reviewDialog = () => screen.findByRole('dialog', { name: 'Review changes' })
const openReview = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Review & save' }))
  return reviewDialog()
}
/** Review & save, then Save changes in the dialog. */
const save = async () => {
  await userEvent.click(within(await openReview()).getByRole('button', { name: 'Save changes' }))
}
/** Applies one override on the Prices tab for a court (by name). */
async function applyRate(courtName: string, dayValue: string, from: string, to: string, price: string) {
  await openTab(PRICES)
  await userEvent.selectOptions(await screen.findByLabelText('Prices for'), courtName)
  await pick('Rate day', dayValue)
  await pick('Rate from', from)
  await pick('Rate to', to)
  if (price) await userEvent.type(screen.getByLabelText('Override price'), price)
  await userEvent.click(screen.getByRole('button', { name: 'Apply rate' }))
}
const lastChanges = () => vi.mocked(saveSchedule).mock.calls.at(-1)![1] as Record<string, unknown[] | undefined>

/** The copy row: choose the day to copy from, then the days to copy to (Mon–Fri, Sat & Sun or every day). */
async function copyDay(from: string, to: 'Mon–Fri' | 'Sat & Sun' | 'every day') {
  await userEvent.selectOptions(await screen.findByLabelText('Copy hours from'), from)
  await userEvent.click(screen.getByRole('button', { name: `Copy to ${to}` }))
}

beforeEach(() => {
  vi.mocked(fetchUpcomingBlackouts).mockReset().mockResolvedValue([])
  previewMock.mockReset()
  previewMock.mockResolvedValue(impact(0))
  vi.mocked(fetchSchedule).mockReset()
  vi.mocked(saveSchedule).mockReset().mockResolvedValue({ venue_id: 'v1', schedule_revision: 8 } as never)
  vi.mocked(fetchCourts).mockReset()
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila' } as VenueSettings)
})

describe('copy hours within a schedule', () => {
  it('copies a weekday to Mon–Fri on the venue hours and leaves the weekend alone', async () => {
    mount()
    await pick('Monday closes', '12')
    await copyDay('Monday', 'Mon–Fri')
    expect(screen.queryByRole('checkbox', { name: 'Also copy hourly rates' })).not.toBeInTheDocument()
    expect(day('Tuesday').getByLabelText('Tuesday closes')).toHaveValue('12')
    expect(day('Friday').getByLabelText('Friday closes')).toHaveValue('12')
    expect(day('Saturday').getByLabelText('Saturday closes')).toHaveValue('22')
    await save()
    const periods = lastChanges().venue_periods as Period[]
    expect(periods.filter((p) => p.day_of_week >= 1 && p.day_of_week <= 5))
      .toEqual([1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, start_minute: 360, end_minute: 720 })))
    expect(periods.filter((p) => p.day_of_week === 6)).toEqual([{ day_of_week: 6, start_minute: 360, end_minute: 1320 }])
  })

  it('a hours-only copy leaves the target days\' rate overrides untouched', async () => {
    mount()
    await applyRate('Court Two', '2', '9', '10', '500')
    await openTab(HOURS)
    await pick('Monday closes', '12')
    await copyDay('Monday', 'Mon–Fri')
    expect(day('Tuesday').getByLabelText('Tuesday closes')).toHaveValue('12')
    await save()
    expect(lastChanges().rate_changes).toEqual([{ court_id: 'c2', day_of_week: 2, start_hour: 9, price: 500 }])
  })

  it('copying never changes any hourly rate, even a saved override on a day it replaces', async () => {
    mount()
    await copyDay('Tuesday', 'Mon–Fri') // Monday has a saved 6 PM 800 override on Court Two
    await pick('Wednesday closes', '20') // another edit so there is something to save besides the copy
    await save()
    expect(lastChanges().rate_changes ?? []).toEqual([])
  })

  it('in a court\'s own view the copy row changes only that court\'s days', async () => {
    mount()
    await editCourt('Court Two')
    await pick('Monday closes', '12')
    await copyDay('Monday', 'Mon–Fri')
    expect(day('Thursday').getByLabelText('Thursday closes')).toHaveValue('12')
    await save()
    expect(saveSchedule).toHaveBeenCalledWith(7, {
      courts: [{
        court_id: 'c2', schedule_mode: 'custom',
        periods: allDays(480, 1200).map((p) => (p.day_of_week >= 1 && p.day_of_week <= 5 ? { ...p, end_minute: 720 } : p)),
      }],
    })
  })

  it('a court on the venue hours has no table of its own to copy in until it is given different hours', async () => {
    mount()
    await ready()
    expect(screen.queryByText(/Editing Court One only/)).not.toBeInTheDocument()
    await userEvent.selectOptions(await screen.findByLabelText('Choose a court'), 'Court One')
    await userEvent.click(screen.getByRole('button', { name: 'Give this court different hours' }))
    expect(screen.getByText(/Editing Court One only/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy to Mon–Fri' })).toBeEnabled()
  })
})

describe('discard unsaved changes', () => {
  it('is hidden when clean; Keep editing keeps the draft; confirming restores the loaded schedule', async () => {
    mount()
    await ready()
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument()
    await pick('Monday closes', '12')
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Discard changes' })).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Discard changes' })).getByRole('button', { name: 'Discard' }))
    expect(screen.getByLabelText('Monday closes')).toHaveValue('22')
    expect(bar()).not.toBeInTheDocument()
    expect(saveSchedule).not.toHaveBeenCalled()
  })
})

describe('impact warning (in the Review changes dialog)', () => {
  const heading = { name: 'Bookings outside the new hours' }

  it('does not preview a clean draft or one with overlaps', async () => {
    mount()
    await ready()
    expect(previewMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', heading)).not.toBeInTheDocument()
    await pick('Tuesday opens', '1')
    await pick('Monday closes', '26')
    expect(day('Monday').getByRole('alert')).toHaveTextContent(/overlap/i)
    expect(screen.getByRole('button', { name: 'Review & save' })).toBeDisabled()
    expect(screen.queryByRole('heading', heading)).not.toBeInTheDocument()
    expect(previewMock).not.toHaveBeenCalled()
  })

  it('previews the whole draft over at most 90 days and lists totals and items', async () => {
    previewMock.mockResolvedValue({
      ...impact(3, 2, true),
      open_play: { total: 2, items: [{ session_id: 's1', court_id: 'c1', title: 'Friday Rally', starts_at: '2026-11-11T10:00:00Z', ends_at: '2026-11-11T12:00:00Z' }] },
    })
    mount()
    await pick('Monday closes', '12')
    const dialog = await openReview()
    expect(within(dialog).getByRole('heading', heading)).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByText(/3 bookings/)).toBeInTheDocument())
    expect(within(dialog).getByText(/2 open play/)).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Court Two')
    expect(dialog).toHaveTextContent(/confirmed/i)
    expect(dialog).toHaveTextContent('Friday Rally')
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
    await pick('Monday closes', '12')
    expect(await within(await openReview()).findByText(/No existing reservations are affected/)).toBeInTheDocument()
  })

  it('a pending preview does not block saving', async () => {
    previewMock.mockReturnValue(new Promise(() => {}))
    mount()
    await pick('Monday closes', '12')
    const dialog = await openReview()
    expect(dialog).toHaveTextContent(/checking/i)
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeEnabled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(saveSchedule).toHaveBeenCalledTimes(1)
  })

  it('a failed preview is quiet, retryable, and does not block saving', async () => {
    previewMock.mockRejectedValueOnce(new Error('boom'))
    previewMock.mockResolvedValue(impact(4))
    mount()
    await pick('Monday closes', '12')
    const dialog = await openReview()
    expect(await within(dialog).findByText(/Couldn't check existing reservations/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeEnabled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }))
    expect(await within(dialog).findByText(/4 bookings/)).toBeInTheDocument()
  })

  it('a result with affected reservations still lets the admin save', async () => {
    previewMock.mockResolvedValue(impact(5, 0, true))
    mount()
    await pick('Monday closes', '12')
    const dialog = await openReview()
    await within(dialog).findByText(/5 bookings/)
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeEnabled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
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
    await pick('Monday closes', '12')
    expect(await within(await openReview()).findByText(/7 bookings/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await pick('Monday closes', '14')
    const dialog = await openReview()
    // the new draft's preview is pending: the old 7 must be gone
    await waitFor(() => expect(within(dialog).queryByText(/7 bookings/)).not.toBeInTheDocument())
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeEnabled()
    await waitFor(() => expect(previewMock.mock.calls.length).toBeGreaterThanOrEqual(2))
    resolveSlow(impact(9))
    expect(await within(dialog).findByText(/9 bookings/)).toBeInTheDocument()
  })

  it('a late answer for an older draft is ignored', async () => {
    const resolvers: Record<number, (v: Impact) => void> = {}
    previewMock.mockImplementation((draft: { venue_periods: Period[] }) =>
      new Promise<Impact>((resolve) => { resolvers[draft.venue_periods.find((p) => p.day_of_week === 1)!.end_minute] = resolve }))
    mount()
    await pick('Monday closes', '12')
    await openReview()
    await waitFor(() => expect(resolvers[720]).toBeDefined())
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await pick('Monday closes', '14')
    const dialog = await openReview()
    await waitFor(() => expect(resolvers[840]).toBeDefined())
    resolvers[840](impact(6))
    expect(await within(dialog).findByText(/6 bookings/)).toBeInTheDocument()
    resolvers[720](impact(8))
    await new Promise((r) => setTimeout(r, 50))
    expect(within(dialog).queryByText(/8 bookings/)).not.toBeInTheDocument()
    expect(within(dialog).getByText(/6 bookings/)).toBeInTheDocument()
  })
})
