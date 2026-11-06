// T17.15 / T17.31: the schedule editor (now the Opening hours and Prices tabs of the Schedule page). Hours are whole-hour periods per weekday; a closed gap is never bookable
// and touching periods are never merged. One save_schedule call carries every pending change with the expected revision.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { fetchCourts, fetchUpcomingBlackouts, fetchVenueSettings, type CourtWithPhotos, type VenueSettings } from '../catalog/api'
import { fetchSchedule, saveSchedule } from './api'
import { SchedulePage } from './SchedulePage'

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

type Period = { id?: string; day_of_week: number; start_minute: number; end_minute: number }
type Rate = { day_of_week: number; start_hour: number; price: number }

const court = (id: string, name: string): CourtWithPhotos => ({
  id, name, sport: 'tennis', default_hourly_rate: 700, is_active: true, sort_order: 1, court_photos: [],
  venue_id: 'v1', description: '', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
})
const allDays = (start = 360, end = 1320): Period[] => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_minute: start, end_minute: end }))

function schedule(over: { revision?: number; courts?: unknown[]; venue?: Period[] } = {}) {
  return {
    venue_id: 'v1',
    schedule_revision: over.revision ?? 7,
    venue_periods: over.venue ?? allDays(),
    courts: over.courts ?? [
      { court_id: 'c1', schedule_mode: 'inherit', schedule_revision: 0, periods: [], rates: [] as Rate[] },
      { court_id: 'c2', schedule_mode: 'custom', schedule_revision: 0, periods: allDays(480, 1200), rates: [{ day_of_week: 1, start_hour: 18, price: 800 }] },
    ],
  }
}

function mount(data: unknown = schedule(), courts: CourtWithPhotos[] = [court('c1', 'Court One'), court('c2', 'Court Two')]) {
  vi.mocked(fetchSchedule).mockResolvedValue(data as never)
  vi.mocked(fetchCourts).mockResolvedValue(courts)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([
    { path: '/admin/schedule', element: <><Link to="/elsewhere">Elsewhere</Link><SchedulePage /></> },
    { path: '/elsewhere', element: <p>Elsewhere page</p> },
  ], { initialEntries: ['/admin/schedule'] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}

const day = (name: string) => within(screen.getByRole('group', { name }))
const pick = async (label: string, value: string) => userEvent.selectOptions(await screen.findByLabelText(label), value)
const choose = async (name: string) => userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Schedule for' }), name)
const openTab = async (name: RegExp) => userEvent.click(await screen.findByRole('tab', { name }))
const HOURS = /^Opening hours/
const PRICES = /^Prices/
/** Review & save, then Save changes in the dialog. */
const save = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Review & save' }))
  await userEvent.click(within(await screen.findByRole('dialog', { name: 'Review changes' })).getByRole('button', { name: 'Save changes' }))
}
const bar = () => screen.queryByRole('region', { name: 'Unsaved changes' })
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

beforeEach(() => {
  previewMock.mockReset().mockResolvedValue({ from: '2026-11-05', to: '2027-02-03', bookings: { total: 0, items: [] }, open_play: { total: 0, items: [] } })
  vi.mocked(fetchUpcomingBlackouts).mockReset().mockResolvedValue([])
  vi.mocked(fetchSchedule).mockReset()
  vi.mocked(saveSchedule).mockReset().mockResolvedValue({ venue_id: 'v1', schedule_revision: 8 } as never)
  vi.mocked(fetchCourts).mockReset()
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila' } as VenueSettings)
})

describe('selector and snapshot', () => {
  it('offers Venue defaults and each court; venue defaults show periods but no rate inputs', async () => {
    mount()
    const selector = await screen.findByRole('combobox', { name: 'Schedule for' })
    expect(within(selector).getAllByRole('option').map((o) => o.textContent)).toEqual(['Venue defaults', 'Court One', 'Court Two'])
    expect(selector).toHaveDisplayValue('Venue defaults')
    expect(day('Monday').getByLabelText('Monday period 1 opens')).toHaveValue('6')
    expect(day('Monday').getByLabelText('Monday period 1 closes')).toHaveValue('22')
    // rates are priced per court on the Prices tab, never in the hours tab
    const hours = within(screen.getByRole('tabpanel', { name: HOURS }))
    expect(hours.queryByLabelText('Override price')).not.toBeInTheDocument()
    expect(hours.queryByRole('button', { name: 'Apply rate' })).not.toBeInTheDocument()
    expect(hours.queryByText(/Default rate/)).not.toBeInTheDocument()
  })

  it('a court shows its mode and own hours; the Prices tab has a read-only default rate and the bulk override form', async () => {
    mount()
    await choose('Court Two')
    expect(screen.getByRole('combobox', { name: 'Court hours' })).toHaveDisplayValue('Custom hours')
    await openTab(PRICES)
    expect(screen.getByText(/Default rate.*700/)).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: /Default rate/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Override price')).toBeInTheDocument()
    await openTab(HOURS)
    expect(day('Monday').getByLabelText('Monday period 1 opens')).toHaveValue('8')
    await choose('Court One')
    expect(screen.getByRole('combobox', { name: 'Court hours' })).toHaveDisplayValue('Use venue hours')
    // inherited hours are shown read-only
    expect(day('Monday').queryByLabelText('Monday period 1 opens')).not.toBeInTheDocument()
    expect(day('Monday').getByText(/6 AM.*10 PM/)).toBeInTheDocument()
  })
})

describe('inherit and custom drafts', () => {
  it('switching to custom copies all seven venue days into the draft only; nothing saves until Save changes', async () => {
    mount()
    await choose('Court One')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Court hours' }), 'Custom hours')
    for (const d of ['Sunday', 'Monday', 'Wednesday', 'Saturday']) expect(day(d).getByLabelText(`${d} period 1 opens`)).toHaveValue('6')
    expect(saveSchedule).not.toHaveBeenCalled()
    await save()
    expect(saveSchedule).toHaveBeenCalledTimes(1)
    expect(saveSchedule).toHaveBeenCalledWith(7, { courts: [{ court_id: 'c1', schedule_mode: 'custom', periods: allDays() }] })
  })

  it('switching back to venue hours needs confirmation; Keep custom hours keeps the draft', async () => {
    mount()
    await choose('Court Two')
    await pick('Monday period 1 closes', '12')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Court hours' }), 'Use venue hours')
    const dialog = await screen.findByRole('dialog', { name: 'Switch to venue hours' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep custom hours' }))
    expect(screen.queryByRole('dialog', { name: 'Switch to venue hours' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Court hours' })).toHaveDisplayValue('Custom hours')
    expect(day('Monday').getByLabelText('Monday period 1 closes')).toHaveValue('12')
  })

  it('confirming sends the court as inherit', async () => {
    mount()
    await choose('Court Two')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Court hours' }), 'Use venue hours')
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Switch to venue hours' })).getByRole('button', { name: 'Switch to venue hours' }))
    expect(screen.getByRole('combobox', { name: 'Court hours' })).toHaveDisplayValue('Use venue hours')
    await save()
    expect(saveSchedule).toHaveBeenCalledWith(7, { courts: [{ court_id: 'c2', schedule_mode: 'inherit' }] })
  })
})

describe('weekday periods', () => {
  it('splits a day, shows the closed gap, and sends the split periods in order', async () => {
    mount()
    await pick('Monday period 1 closes', '12')
    await userEvent.click(day('Monday').getByRole('button', { name: 'Add Monday period' }))
    await pick('Monday period 2 opens', '14')
    await pick('Monday period 2 closes', '22')
    expect(day('Monday').getByText('Closed 12 PM to 2 PM')).toBeInTheDocument()
    await save()
    expect(lastChanges().venue_periods).toEqual([
      ...allDays().filter((p) => p.day_of_week === 0),
      { day_of_week: 1, start_minute: 360, end_minute: 720 },
      { day_of_week: 1, start_minute: 840, end_minute: 1320 },
      ...allDays().filter((p) => p.day_of_week > 1),
    ])
    expect(lastChanges().courts ?? []).toEqual([])
    expect(lastChanges().rate_changes ?? []).toEqual([])
  })

  it('removes a period and shows the day as closed all day', async () => {
    mount()
    await screen.findByRole('group', { name: 'Tuesday' })
    await userEvent.click(day('Tuesday').getByRole('button', { name: 'Remove Tuesday period 1' }))
    expect(day('Tuesday').getByText('Closed all day')).toBeInTheDocument()
    await save()
    expect((lastChanges().venue_periods as Period[]).some((p) => p.day_of_week === 2)).toBe(false)
  })

  it('labels midnight and next-day ends, with whole-hour options only', async () => {
    mount(schedule({ venue: [{ day_of_week: 5, start_minute: 1320, end_minute: 1560 }] }))
    const closes = await screen.findByLabelText('Friday period 1 closes')
    const labels = within(closes).getAllByRole('option').map((o) => o.textContent)
    expect(labels).toContain('Midnight')
    expect(labels).toContain('2 AM (next day)')
    expect(labels).not.toContain('10 PM (next day)')
    expect(within(closes).getByRole('option', { name: 'Midnight' })).toHaveValue('24')
    expect(within(closes).getByRole('option', { name: '2 AM (next day)' })).toHaveValue('26')
    expect(closes).toHaveValue('26')
    expect(screen.getByLabelText('Friday period 1 opens')).toHaveValue('22')
  })

  it('flags overlapping periods inline and disables Save; touching periods are allowed and never merged', async () => {
    mount()
    await pick('Monday period 1 closes', '12')
    await userEvent.click(day('Monday').getByRole('button', { name: 'Add Monday period' }))
    await pick('Monday period 2 opens', '10')
    await pick('Monday period 2 closes', '14')
    expect(day('Monday').getByRole('alert')).toHaveTextContent(/overlap/i)
    expect(screen.getByRole('button', { name: 'Review & save' })).toBeDisabled()
    await pick('Monday period 2 opens', '12')
    expect(day('Monday').queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review & save' })).toBeEnabled()
    await save()
    const monday = (lastChanges().venue_periods as Period[]).filter((p) => p.day_of_week === 1)
    expect(monday).toEqual([
      { day_of_week: 1, start_minute: 360, end_minute: 720 },
      { day_of_week: 1, start_minute: 720, end_minute: 840 },
    ])
  })

  it('flags an overnight period running into the next day\'s opening', async () => {
    mount()
    await pick('Tuesday period 1 opens', '1')
    await pick('Monday period 1 closes', '26')
    expect(screen.getAllByRole('alert').some((a) => /overlap/i.test(a.textContent ?? ''))).toBe(true)
    expect(screen.getByRole('button', { name: 'Review & save' })).toBeDisabled()
  })
})

describe('weekly override rates', () => {
  it('bulk fill sets an override for each hour; moving or removing hours does not touch rate_changes', async () => {
    mount()
    await choose('Court Two')
    await pick('Monday period 1 closes', '12')
    await userEvent.click(day('Wednesday').getByRole('button', { name: 'Remove Wednesday period 1' }))
    await applyRate('Court Two', '2', '9', '11', '950')
    await save()
    const changes = lastChanges()
    expect(changes.rate_changes).toEqual([
      { court_id: 'c2', day_of_week: 2, start_hour: 9, price: 950 },
      { court_id: 'c2', day_of_week: 2, start_hour: 10, price: 950 },
    ])
    expect((changes.courts as { court_id: string }[]).map((c) => c.court_id)).toEqual(['c2'])
  }, 20000)

  it('moving hours alone sends no rate changes, and an empty override clears to the court default (price null)', async () => {
    mount()
    await choose('Court Two')
    await pick('Monday period 1 closes', '12')
    await save()
    expect(lastChanges().rate_changes ?? []).toEqual([])
    await applyRate('Court Two', '1', '18', '20', '')
    await save()
    // only hour 18 had an override; hour 19 has none, so there is nothing to clear
    expect(lastChanges().rate_changes).toEqual([{ court_id: 'c2', day_of_week: 1, start_hour: 18, price: null }])
  })
})

describe('dirty state and saving', () => {
  it('summarises pending edits before Save and warns when leaving; Stay keeps the draft, Leave goes', async () => {
    mount()
    await screen.findByRole('combobox', { name: 'Schedule for' })
    expect(bar()).not.toBeInTheDocument()
    await pick('Monday period 1 closes', '12')
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent('1 unsaved change')
    await userEvent.click(screen.getByRole('button', { name: 'Review & save' }))
    expect(within(await screen.findByRole('dialog', { name: 'Review changes' })).getByText(/Monday/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await userEvent.click(screen.getByRole('link', { name: 'Elsewhere' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Unsaved changes' })).getByRole('button', { name: 'Stay' }))
    expect(screen.getByLabelText('Monday period 1 closes')).toHaveValue('12')
    await userEvent.click(screen.getByRole('link', { name: 'Elsewhere' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Unsaved changes' })).getByRole('button', { name: 'Leave' }))
    expect(await screen.findByText('Elsewhere page')).toBeInTheDocument()
    expect(saveSchedule).not.toHaveBeenCalled()
  })

  it('does not block leaving when nothing is pending', async () => {
    mount()
    await screen.findByRole('combobox', { name: 'Schedule for' })
    await userEvent.click(screen.getByRole('link', { name: 'Elsewhere' }))
    expect(await screen.findByText('Elsewhere page')).toBeInTheDocument()
  })

  it('sends ONE save with the expected revision and every change together, then resets the draft to the saved data', async () => {
    mount()
    await pick('Monday period 1 closes', '12')
    await choose('Court One')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Court hours' }), 'Custom hours')
    await applyRate('Court Two', '3', '8', '9', '1000')
    vi.mocked(fetchSchedule).mockResolvedValue(schedule({ revision: 8 }) as never)
    await save()
    expect(saveSchedule).toHaveBeenCalledTimes(1)
    const [revision, changes] = vi.mocked(saveSchedule).mock.calls[0]
    expect(revision).toBe(7)
    expect(changes).toMatchObject({
      courts: [{ court_id: 'c1', schedule_mode: 'custom' }],
      rate_changes: [{ court_id: 'c2', day_of_week: 3, start_hour: 8, price: 1000 }],
    })
    expect((changes as { venue_periods: Period[] }).venue_periods).toContainEqual({ day_of_week: 1, start_minute: 360, end_minute: 720 })
    await waitFor(() => expect(vi.mocked(fetchSchedule).mock.calls.length).toBeGreaterThanOrEqual(2))
    await waitFor(() => expect(bar()).not.toBeInTheDocument())
    // the next save uses the new revision
    await openTab(HOURS)
    await choose('Venue defaults')
    await pick('Monday period 1 closes', '20')
    await save()
    expect(vi.mocked(saveSchedule).mock.calls[1][0]).toBe(8)
  })

  it('on schedule_conflict shows a reload message and keeps the draft', async () => {
    vi.mocked(saveSchedule).mockRejectedValue(new ApiError('The schedule changed. Reload and try again.', 'P0001', 'schedule_conflict'))
    mount()
    await pick('Monday period 1 closes', '12')
    await save()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/reload/i)
    expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument()
    expect(screen.getByLabelText('Monday period 1 closes')).toHaveValue('12')
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent('1 unsaved change')
    await waitFor(() => expect(vi.mocked(fetchSchedule).mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('shows other save errors in context with the message and a retry that saves again', async () => {
    vi.mocked(saveSchedule).mockRejectedValueOnce(new ApiError('permission denied for table courts', 'P0001'))
    mount()
    await pick('Monday period 1 closes', '12')
    await save()
    expect(await screen.findByText(/permission denied for table courts/)).toBeInTheDocument()
    expect(screen.getByLabelText('Monday period 1 closes')).toHaveValue('12')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(saveSchedule).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(bar()).not.toBeInTheDocument())
  })
})

describe('loading, empty and error states', () => {
  it('shows a loader while the schedule loads', () => {
    vi.mocked(fetchSchedule).mockReturnValue(new Promise(() => {}))
    vi.mocked(fetchCourts).mockResolvedValue([])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const router = createMemoryRouter([{ path: '/admin/schedule', element: <SchedulePage /> }], { initialEntries: ['/admin/schedule'] })
    render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
    expect(screen.getAllByRole('status').some((el) => /Loading/.test(el.textContent ?? ''))).toBe(true)
  })

  it('a venue with no courts says so and still edits venue defaults', async () => {
    mount(schedule({ courts: [] }), [])
    expect(await within(await screen.findByRole('tabpanel', { name: HOURS })).findByText(/No courts yet/)).toBeInTheDocument()
    expect(within(screen.getByRole('combobox', { name: 'Schedule for' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['Venue defaults'])
    expect(day('Monday').getByLabelText('Monday period 1 opens')).toBeInTheDocument()
  })

  it('shows a load error with Try again that refetches', async () => {
    vi.mocked(fetchSchedule).mockRejectedValueOnce(new ApiError('boom load', 'P0001'))
    vi.mocked(fetchCourts).mockResolvedValue([])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const router = createMemoryRouter([{ path: '/admin/schedule', element: <SchedulePage /> }], { initialEntries: ['/admin/schedule'] })
    vi.mocked(fetchSchedule).mockResolvedValueOnce(schedule() as never)
    render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
    // first call (mockRejectedValueOnce was queued before the Once-resolve) fails
    expect(await screen.findByText(/boom load/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('combobox', { name: 'Schedule for' })).toBeInTheDocument()
  })
})
