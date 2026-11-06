// T17.15 / T17.31 / T17.32: the schedule editor (the Opening hours table and the Prices tab of the Schedule page). Hours are whole-hour periods per weekday; a closed gap is never bookable
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
const section = async () => within(await screen.findByRole('region', { name: 'Courts with different hours' }))
/** Opens a court's own-hours view from the "Courts with different hours" list. */
const editCourt = async (name: string) => userEvent.click(await (await section()).findByRole('button', { name: `Edit hours for ${name}` }))
const backToAll = async () => { const b = screen.queryByRole('button', { name: 'Back to all courts' }); if (b) await userEvent.click(b) }
const giveHours = async (name: string) => {
  await userEvent.selectOptions(await screen.findByLabelText('Choose a court'), name)
  await userEvent.click(screen.getByRole('button', { name: 'Give this court different hours' }))
}
const ready = () => screen.findByRole('switch', { name: 'Monday open' })
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

describe('venue hours and a court\'s own hours', () => {
  it('shows the venue\'s hours in the table; rates are priced per court on the Prices tab, never in the hours tab', async () => {
    mount()
    await ready()
    expect(day('Monday').getByLabelText('Monday opens')).toHaveValue('6')
    expect(day('Monday').getByLabelText('Monday closes')).toHaveValue('22')
    const hours = within(screen.getByRole('tabpanel', { name: HOURS }))
    expect(hours.queryByLabelText('Override price')).not.toBeInTheDocument()
    expect(hours.queryByRole('button', { name: 'Apply rate' })).not.toBeInTheDocument()
    expect(hours.queryByText(/Default rate/)).not.toBeInTheDocument()
  })

  it('a court with its own hours shows them in its edit view; the Prices tab has a read-only default rate and the bulk override form', async () => {
    mount()
    await editCourt('Court Two')
    expect(screen.getByText(/Editing Court Two only/)).toBeInTheDocument()
    expect(day('Monday').getByLabelText('Monday opens')).toHaveValue('8')
    await openTab(PRICES)
    await userEvent.selectOptions(await screen.findByLabelText('Prices for'), 'Court Two')
    expect(screen.getByText(/Default rate.*700/)).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: /Default rate/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Override price')).toBeInTheDocument()
  })

  it('a court on the venue hours has no edit view of its own: it is offered under Give this court different hours', async () => {
    mount()
    await ready()
    const list = (await section()).getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(list.some((t) => t.includes('Court One'))).toBe(false)
    expect(within(await screen.findByLabelText('Choose a court')).getAllByRole('option').map((o) => o.textContent)).toContain('Court One')
  })
})

describe('inherit and custom drafts', () => {
  it('giving a court different hours copies all seven venue days into the draft only; nothing saves until Save changes', async () => {
    mount()
    await giveHours('Court One')
    for (const d of ['Sunday', 'Monday', 'Wednesday', 'Saturday']) expect(day(d).getByLabelText(`${d} opens`)).toHaveValue('6')
    expect(saveSchedule).not.toHaveBeenCalled()
    await save()
    expect(saveSchedule).toHaveBeenCalledTimes(1)
    expect(saveSchedule).toHaveBeenCalledWith(7, { courts: [{ court_id: 'c1', schedule_mode: 'custom', periods: allDays() }] })
  })

  it('going back to the opening hours needs confirmation; Keep different hours keeps the draft', async () => {
    mount()
    await editCourt('Court Two')
    await pick('Monday closes', '12')
    await backToAll()
    await userEvent.click(await (await section()).findByRole('button', { name: 'Use opening hours for Court Two' }))
    const dialog = await screen.findByRole('dialog', { name: 'Use opening hours for Court Two' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep different hours' }))
    expect(screen.queryByRole('dialog', { name: 'Use opening hours for Court Two' })).not.toBeInTheDocument()
    await editCourt('Court Two')
    expect(day('Monday').getByLabelText('Monday closes')).toHaveValue('12')
  })

  it('confirming sends the court as inherit', async () => {
    mount()
    await userEvent.click(await (await section()).findByRole('button', { name: 'Use opening hours for Court Two' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Use opening hours for Court Two' })).getByRole('button', { name: 'Use opening hours' }))
    await save()
    expect(saveSchedule).toHaveBeenCalledWith(7, { courts: [{ court_id: 'c2', schedule_mode: 'inherit' }] })
  })
})

describe('weekday periods', () => {
  it('splits a day with a break, shows it in words, and sends the split periods in order', async () => {
    mount()
    await ready()
    await userEvent.click(day('Monday').getByRole('button', { name: /Add a break/ }))
    expect(day('Monday').getByText('Break 12 PM – 2 PM')).toBeInTheDocument()
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

  it('switches a day to Closed and sends it without periods', async () => {
    mount()
    await userEvent.click(await screen.findByRole('switch', { name: 'Tuesday open' }))
    expect(day('Tuesday').getByText(/closed/i)).toBeInTheDocument()
    await save()
    expect((lastChanges().venue_periods as Period[]).some((p) => p.day_of_week === 2)).toBe(false)
  })

  it('labels midnight and next-day ends, with whole-hour options only', async () => {
    mount(schedule({ venue: [{ day_of_week: 5, start_minute: 1320, end_minute: 1560 }] }))
    const closes = await screen.findByLabelText('Friday closes')
    const labels = within(closes).getAllByRole('option').map((o) => o.textContent)
    expect(labels).toContain('Midnight')
    expect(labels).toContain('2 AM (next day)')
    expect(labels).not.toContain('10 PM (next day)')
    expect(within(closes).getByRole('option', { name: 'Midnight' })).toHaveValue('24')
    expect(within(closes).getByRole('option', { name: '2 AM (next day)' })).toHaveValue('26')
    expect(closes).toHaveValue('26')
    expect(screen.getByLabelText('Friday opens')).toHaveValue('22')
  })

  it('flags overlapping days inline and disables Save; touching hours are allowed and never merged', async () => {
    mount()
    await pick('Tuesday opens', '1')
    await pick('Monday closes', '26')
    expect(day('Monday').getByRole('alert')).toHaveTextContent(/overlap/i)
    expect(screen.getByRole('button', { name: 'Review & save' })).toBeDisabled()
    await pick('Monday closes', '25')
    expect(day('Monday').queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review & save' })).toBeEnabled()
    await save()
    const periods = lastChanges().venue_periods as Period[]
    expect(periods.filter((p) => p.day_of_week === 1)).toEqual([{ day_of_week: 1, start_minute: 360, end_minute: 1500 }])
    expect(periods.filter((p) => p.day_of_week === 2)).toEqual([{ day_of_week: 2, start_minute: 60, end_minute: 1320 }])
  })

  it('touching periods inside a day stay two periods when another day is edited', async () => {
    mount(schedule({ venue: allDays().flatMap((p) => (p.day_of_week === 1 ? [{ ...p, end_minute: 720 }, { ...p, start_minute: 720 }] : [p])) }))
    await ready()
    await pick('Thursday closes', '20')
    await save()
    expect((lastChanges().venue_periods as Period[]).filter((p) => p.day_of_week === 1)).toEqual([
      { day_of_week: 1, start_minute: 360, end_minute: 720 },
      { day_of_week: 1, start_minute: 720, end_minute: 1320 },
    ])
  })

  it('flags an overnight close running into the next day\'s opening', async () => {
    mount()
    await pick('Tuesday opens', '1')
    await pick('Monday closes', '26')
    expect(screen.getAllByRole('alert').some((a) => /overlap/i.test(a.textContent ?? ''))).toBe(true)
    expect(screen.getByRole('button', { name: 'Review & save' })).toBeDisabled()
  })
})

describe('weekly override rates', () => {
  it('bulk fill sets an override for each hour; moving or removing hours does not touch rate_changes', async () => {
    mount()
    await editCourt('Court Two')
    await pick('Monday closes', '12')
    await userEvent.click(screen.getByRole('switch', { name: 'Wednesday open' }))
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
    await editCourt('Court Two')
    await pick('Monday closes', '12')
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
    await ready()
    expect(bar()).not.toBeInTheDocument()
    await pick('Monday closes', '12')
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent('1 unsaved change')
    await userEvent.click(screen.getByRole('button', { name: 'Review & save' }))
    expect(within(await screen.findByRole('dialog', { name: 'Review changes' })).getByText(/Monday/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await userEvent.click(screen.getByRole('link', { name: 'Elsewhere' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Unsaved changes' })).getByRole('button', { name: 'Stay' }))
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
    await userEvent.click(screen.getByRole('link', { name: 'Elsewhere' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Unsaved changes' })).getByRole('button', { name: 'Leave' }))
    expect(await screen.findByText('Elsewhere page')).toBeInTheDocument()
    expect(saveSchedule).not.toHaveBeenCalled()
  })

  it('does not block leaving when nothing is pending', async () => {
    mount()
    await ready()
    await userEvent.click(screen.getByRole('link', { name: 'Elsewhere' }))
    expect(await screen.findByText('Elsewhere page')).toBeInTheDocument()
  })

  it('sends ONE save with the expected revision and every change together, then resets the draft to the saved data', async () => {
    mount()
    await pick('Monday closes', '12')
    await giveHours('Court One')
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
    await backToAll()
    await pick('Monday closes', '20')
    await save()
    expect(vi.mocked(saveSchedule).mock.calls[1][0]).toBe(8)
  })

  it('on schedule_conflict shows a reload message and keeps the draft', async () => {
    vi.mocked(saveSchedule).mockRejectedValue(new ApiError('The schedule changed. Reload and try again.', 'P0001', 'schedule_conflict'))
    mount()
    await pick('Monday closes', '12')
    await save()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/reload/i)
    expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent('1 unsaved change')
    await waitFor(() => expect(vi.mocked(fetchSchedule).mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('shows other save errors in context with the message and a retry that saves again', async () => {
    vi.mocked(saveSchedule).mockRejectedValueOnce(new ApiError('permission denied for table courts', 'P0001'))
    mount()
    await pick('Monday closes', '12')
    await save()
    expect(await screen.findByText(/permission denied for table courts/)).toBeInTheDocument()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
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

  it('a venue with no courts still edits the opening hours and offers no court controls', async () => {
    mount(schedule({ courts: [] }), [])
    await ready()
    expect(day('Monday').getByLabelText('Monday opens')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Give this court different hours' })).not.toBeInTheDocument()
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
    expect(await ready()).toBeInTheDocument()
  })
})

describe('override rates summary (T17.33)', () => {
  const hoursAt = (days: number[], from: number, to: number, price: number): Rate[] =>
    days.flatMap((d) => Array.from({ length: to - from }, (_, i) => ({ day_of_week: d, start_hour: from + i, price })))

  it('groups days with the same hours and price into one item each instead of listing every hour', async () => {
    const rates = [...hoursAt([1, 2, 3, 4, 5], 17, 22, 500), ...hoursAt([6, 0], 6, 22, 500)]
    mount(schedule({ courts: [{ court_id: 'c1', schedule_mode: 'inherit', schedule_revision: 0, periods: [], rates }] }), [court('c1', 'Pickleball 1')])
    await openTab(PRICES)
    const overrides = within(await screen.findByRole('region', { name: "Pickleball 1's override rates" }))
    const items = overrides.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Mon–Fri')
    expect(items[0]).toHaveTextContent('5 PM – 10 PM')
    expect(items[0]).toHaveTextContent('₱500')
    expect(items[1]).toHaveTextContent('Sat & Sun')
    expect(items[1]).toHaveTextContent('6 AM – 10 PM')
    expect(items[1]).toHaveTextContent('₱500')
    expect(overrides.queryByText(/6 PM ₱500/)).not.toBeInTheDocument()
    expect(overrides.queryByText(/Monday/)).not.toBeInTheDocument()
  })

  it('shows two runs of one day group as two time-and-price lines inside its item', async () => {
    const rates = [...hoursAt([1], 9, 11, 400), ...hoursAt([1], 18, 21, 700)]
    mount(schedule({ courts: [{ court_id: 'c1', schedule_mode: 'inherit', schedule_revision: 0, periods: [], rates }] }), [court('c1', 'Pickleball 1')])
    await openTab(PRICES)
    const items = within(await screen.findByRole('region', { name: "Pickleball 1's override rates" })).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Monday')
    expect(items[0]).toHaveTextContent('9 AM – 11 AM')
    expect(items[0]).toHaveTextContent('₱400')
    expect(items[0]).toHaveTextContent('6 PM – 9 PM')
    expect(items[0]).toHaveTextContent('₱700')
  })

  it('keeps the empty text when the court has no overrides', async () => {
    mount()
    await openTab(PRICES)
    await userEvent.selectOptions(await screen.findByLabelText('Prices for'), 'Court One')
    expect(screen.getByText('None yet. Every hour uses the default rate.')).toBeInTheDocument()
  })
})
