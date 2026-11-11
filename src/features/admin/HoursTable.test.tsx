// T17.32: the opening hours table on /admin/schedule. One row per day (group named for the day): an Open/Closed switch,
// an "opens" and a "closes" time list, "+ Add a break" (as often as wanted), plain-word overlap messages that block
// Review & save, and one copy row. Every period shape save_schedule stores loads and saves back unchanged.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import baseUserEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCourts, fetchUpcomingBlackouts, fetchVenueSettings, type CourtWithPhotos, type VenueSettings } from '../catalog/api'
import { fetchSchedule, saveSchedule, type ScheduleData, type SchedulePeriod } from './api'
import { SchedulePage } from './SchedulePage'

// No per-action macrotask delay (H12): the real-timer waits dominated this file's runtime.
const userEvent = baseUserEvent.setup({ delay: null })

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
  previewScheduleImpact: vi.fn().mockResolvedValue({ from: '', to: '', bookings: { total: 0, items: [] }, open_play: { total: 0, items: [] } }),
}))

const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const p = (day: number, startHour: number, endHour: number): SchedulePeriod => ({ day_of_week: day, start_minute: startHour * 60, end_minute: endHour * 60 })
const week = (start = 6, end = 22): SchedulePeriod[] => [0, 1, 2, 3, 4, 5, 6].map((d) => p(d, start, end))
/** Everything except the given days, plus the given periods, in day then start order. */
const sorted = (list: SchedulePeriod[]) => [...list].sort((a, b) => a.day_of_week - b.day_of_week || a.start_minute - b.start_minute)
const replaceDays = (base: SchedulePeriod[], ...extra: SchedulePeriod[]) =>
  sorted([...base.filter((x) => !extra.some((e) => e.day_of_week === x.day_of_week)), ...extra])

const court = (id: string, name: string): CourtWithPhotos => ({
  id, name, sport: 'tennis', default_hourly_rate: 700, is_active: true, sort_order: 1, court_photos: [],
  venue_id: 'v1', description: '', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
})

function mount(venue: SchedulePeriod[] = week()) {
  const data: ScheduleData = {
    venue_id: 'v1',
    schedule_revision: 7,
    venue_periods: venue,
    courts: [{ court_id: 'c1', schedule_mode: 'inherit', schedule_revision: 0, periods: [], rates: [] }],
  }
  vi.mocked(fetchSchedule).mockResolvedValue(data)
  vi.mocked(fetchCourts).mockResolvedValue([court('c1', 'Court One')])
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([{ path: '/admin/schedule', element: <SchedulePage /> }], { initialEntries: ['/admin/schedule'] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}

const group = (name: string) => within(screen.getByRole('group', { name }))
const pick = async (label: string, value: string) => userEvent.selectOptions(await screen.findByLabelText(label), value)
const addBreak = async (day: string) => userEvent.click(group(day).getByRole('button', { name: /Add a break/ }))
const removeBreaks = (day: string) => group(day).queryAllByRole('button', { name: /Remove.*break/ })
const reviewButton = () => screen.getByRole('button', { name: 'Review & save' })
const bar = () => screen.queryByRole('region', { name: 'Unsaved changes' })
const save = async () => {
  await userEvent.click(reviewButton())
  await userEvent.click(within(await screen.findByRole('dialog', { name: 'Review changes' })).getByRole('button', { name: 'Save changes' }))
}
const saved = () => (vi.mocked(saveSchedule).mock.calls.at(-1)![1] as { venue_periods?: SchedulePeriod[] }).venue_periods
const ready = () => screen.findByRole('switch', { name: 'Monday open' })

beforeEach(() => {
  vi.mocked(fetchUpcomingBlackouts).mockReset().mockResolvedValue([])
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila' } as VenueSettings)
  vi.mocked(fetchSchedule).mockReset()
  vi.mocked(fetchCourts).mockReset()
  vi.mocked(saveSchedule).mockReset().mockResolvedValue({ venue_id: 'v1', schedule_revision: 8 } as never)
})

describe('the table and its labels', () => {
  it('has a row for each day, Monday first, with a switch and time lists whose labels name the day', async () => {
    mount()
    await ready()
    for (const name of NAMES) expect(screen.getByRole('group', { name })).toBeInTheDocument()
    for (const name of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      expect(screen.getByRole('switch', { name: `${name} open` })).toBeChecked()
      expect(screen.getByLabelText(`${name} opens`)).toHaveValue('6')
      expect(screen.getByLabelText(`${name} closes`)).toHaveValue('22')
      expect(group(name).getByRole('switch', { name: `${name} open` })).toBeInTheDocument()
    }
  })

  it('offers any opening hour and closings whole hours later, up to 23 hours on, marked (next day)', async () => {
    mount()
    const opens = await screen.findByLabelText('Monday opens')
    expect(within(opens).getAllByRole('option').map((o) => o.textContent)).toEqual(
      ['12 AM', '1 AM', '2 AM', '3 AM', '4 AM', '5 AM', '6 AM', '7 AM', '8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM'])
    const closes = within(screen.getByLabelText('Monday closes')).getAllByRole('option').map((o) => o.textContent)
    expect(closes[0]).toBe('7 AM')
    expect(closes).toContain('Midnight')
    expect(closes).toContain('1 AM (next day)')
    expect(closes.at(-1)).toBe('5 AM (next day)') // 23 hours after 6 AM
    expect(closes).not.toContain('6 AM (next day)')
    expect(within(screen.getByLabelText('Monday closes')).getByRole('option', { name: 'Midnight' })).toHaveValue('24')
    expect(within(screen.getByLabelText('Monday closes')).getByRole('option', { name: '2 AM (next day)' })).toHaveValue('26')
  })
})

describe('the Open/Closed switch', () => {
  it('turns a day off: its time lists go and the saved periods for the day are dropped', async () => {
    mount()
    await userEvent.click(await screen.findByRole('switch', { name: 'Tuesday open' }))
    expect(screen.getByRole('switch', { name: 'Tuesday open' })).not.toBeChecked()
    expect(screen.queryByLabelText('Tuesday opens')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tuesday closes')).not.toBeInTheDocument()
    expect(group('Tuesday').getByText(/closed/i)).toBeInTheDocument()
    await save()
    expect(saved()).toEqual(week().filter((x) => x.day_of_week !== 2))
  })

  it('shows a day that is closed in the saved hours as off', async () => {
    mount(week().filter((x) => x.day_of_week !== 3))
    expect(await screen.findByRole('switch', { name: 'Wednesday open' })).not.toBeChecked()
    expect(screen.queryByLabelText('Wednesday opens')).not.toBeInTheDocument()
    expect(bar()).not.toBeInTheDocument()
  })

  it('switching back on restores the saved hours, breaks included, and then there is nothing to save', async () => {
    mount(replaceDays(week(), p(2, 8, 12), p(2, 14, 20)))
    await userEvent.click(await screen.findByRole('switch', { name: 'Tuesday open' }))
    expect(bar()).toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch', { name: 'Tuesday open' }))
    expect(screen.getByLabelText('Tuesday opens')).toHaveValue('8')
    expect(screen.getByLabelText('Tuesday closes')).toHaveValue('20')
    expect(group('Tuesday').getByText('Break 12 PM – 2 PM')).toBeInTheDocument()
    expect(bar()).not.toBeInTheDocument()
  })

  it('opening a day that was never open gives 6 AM – 10 PM', async () => {
    mount(week().filter((x) => x.day_of_week !== 0))
    await userEvent.click(await screen.findByRole('switch', { name: 'Sunday open' }))
    expect(screen.getByLabelText('Sunday opens')).toHaveValue('6')
    expect(screen.getByLabelText('Sunday closes')).toHaveValue('22')
    await save()
    expect(saved()).toEqual(week())
  })
})

describe('breaks', () => {
  it('adds a break in words, 12 PM – 2 PM on a 6 AM – 10 PM day, and saves the two ranges', async () => {
    mount()
    await ready()
    expect(removeBreaks('Monday')).toHaveLength(0)
    await addBreak('Monday')
    expect(group('Monday').getByText('Break 12 PM – 2 PM')).toBeInTheDocument()
    expect(screen.getByLabelText('Monday break 1 starts')).toHaveValue('12')
    expect(screen.getByLabelText('Monday break 1 ends')).toHaveValue('14')
    expect(screen.getByLabelText('Monday opens')).toHaveValue('6')
    expect(screen.getByLabelText('Monday closes')).toHaveValue('22')
    await save()
    expect(saved()).toEqual(replaceDays(week(), p(1, 6, 12), p(1, 14, 22)))
  })

  it('can be used more than once: each break is listed and has its own Remove break', async () => {
    mount()
    await ready()
    await addBreak('Monday')
    await addBreak('Monday')
    expect(removeBreaks('Monday')).toHaveLength(2)
    expect(group('Monday').getAllByText(/^Break \d/)).toHaveLength(2)
    expect(screen.getByLabelText('Monday break 2 starts')).toBeInTheDocument()
    await save()
    const monday = saved()!.filter((x) => x.day_of_week === 1)
    expect(monday).toHaveLength(3)
    expect(monday[0].start_minute).toBe(360)
    expect(monday[2].end_minute).toBe(1320)
  })

  it('edits a break\'s times and says so in words', async () => {
    mount()
    await ready()
    await addBreak('Monday')
    await pick('Monday break 1 starts', '11')
    await pick('Monday break 1 ends', '15')
    expect(group('Monday').getByText('Break 11 AM – 3 PM')).toBeInTheDocument()
    await save()
    expect(saved()).toEqual(replaceDays(week(), p(1, 6, 11), p(1, 15, 22)))
  })

  it('Remove break joins the two ranges again, and the day is back to saved (nothing to save)', async () => {
    mount()
    await ready()
    await addBreak('Monday')
    await userEvent.click(removeBreaks('Monday')[0])
    expect(group('Monday').queryByText(/^Break/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Monday opens')).toHaveValue('6')
    expect(screen.getByLabelText('Monday closes')).toHaveValue('22')
    expect(bar()).not.toBeInTheDocument()
  })

  it('removes only the chosen break when a day has several', async () => {
    mount(replaceDays(week(), p(1, 6, 10), p(1, 12, 14), p(1, 16, 22)))
    await ready()
    expect(removeBreaks('Monday')).toHaveLength(2)
    await userEvent.click(removeBreaks('Monday')[0])
    await save()
    expect(saved()).toEqual(replaceDays(week(), p(1, 6, 14), p(1, 16, 22)))
  })

  it('has no Add a break for a closed day', async () => {
    mount(week().filter((x) => x.day_of_week !== 3))
    await ready()
    expect(group('Wednesday').queryByRole('button', { name: /Add a break/ })).not.toBeInTheDocument()
  })
})

describe('after-midnight and 24-hour days', () => {
  it('closing at 2 AM (next day) is offered, saved as 26 hours, and shown as chosen', async () => {
    mount()
    await pick('Friday closes', '26')
    expect(screen.getByLabelText('Friday closes')).toHaveDisplayValue('2 AM (next day)')
    await save()
    expect(saved()).toEqual(replaceDays(week(), p(5, 6, 26)))
  })

  it('a day opening at 10 PM and closing at 2 AM loads with those values and closes list from 11 PM', async () => {
    mount(replaceDays(week(), p(5, 22, 26)))
    expect(await screen.findByLabelText('Friday opens')).toHaveValue('22')
    expect(screen.getByLabelText('Friday closes')).toHaveValue('26')
    const closes = within(screen.getByLabelText('Friday closes')).getAllByRole('option').map((o) => o.textContent)
    expect(closes[0]).toBe('11 PM')
    expect(closes).not.toContain('10 PM (next day)')
    expect(closes.at(-1)).toBe('9 PM (next day)')
  })

  it('a full 24 hours is only 12 AM to Midnight: opening at 12 AM offers Midnight and no next-day closings', async () => {
    mount()
    await pick('Saturday opens', '0')
    const closes = within(screen.getByLabelText('Saturday closes')).getAllByRole('option').map((o) => o.textContent)
    expect(closes.at(-1)).toBe('Midnight')
    expect(closes.some((c) => /next day/.test(c ?? ''))).toBe(false)
    await pick('Saturday closes', '24')
    await save()
    expect(saved()).toEqual(replaceDays(week(), p(6, 0, 24)))
  })

  it('opening at 1 AM cannot run a full 24 hours: the latest close is Midnight', async () => {
    mount()
    await pick('Saturday opens', '1')
    const closes = within(screen.getByLabelText('Saturday closes')).getAllByRole('option').map((o) => o.textContent)
    expect(closes.at(-1)).toBe('Midnight')
  })

  it('moving the opening past the closing pushes the closing one hour after it', async () => {
    mount()
    await pick('Monday opens', '23')
    expect(screen.getByLabelText('Monday closes')).toHaveValue('24')
  })

  it('can add a break to an after-midnight day and keeps its closing', async () => {
    mount(replaceDays(week(), p(5, 18, 26)))
    await ready()
    await addBreak('Friday')
    expect(removeBreaks('Friday')).toHaveLength(1)
    expect(screen.getByLabelText('Friday opens')).toHaveValue('18')
    expect(screen.getByLabelText('Friday closes')).toHaveValue('26')
  })
})

describe('overlap messages', () => {
  it('explains in the day\'s row that Monday running into Tuesday\'s opening overlaps, and blocks Review & save', async () => {
    mount()
    await pick('Tuesday opens', '1')
    await pick('Monday closes', '26')
    for (const name of ['Monday', 'Tuesday']) {
      const alert = group(name).getByRole('alert')
      expect(alert).toHaveTextContent(/overlap/i)
      expect(alert).toHaveTextContent('Monday')
      expect(alert).toHaveTextContent('Tuesday')
    }
    expect(group('Wednesday').queryByRole('alert')).not.toBeInTheDocument()
    expect(reviewButton()).toBeDisabled()
    await pick('Monday closes', '25') // 1 AM next day meets Tuesday's 1 AM opening: touching is fine
    expect(group('Monday').queryByRole('alert')).not.toBeInTheDocument()
    expect(reviewButton()).toBeEnabled()
  })

  it('catches Sunday running past midnight into Monday\'s opening, the week\'s wrap included, and blocks saving', async () => {
    mount()
    await pick('Monday opens', '1')
    await pick('Sunday closes', '27')
    for (const name of ['Sunday', 'Monday']) {
      const alert = group(name).getByRole('alert')
      expect(alert).toHaveTextContent(/overlap/i)
      expect(alert).toHaveTextContent('Sunday')
      expect(alert).toHaveTextContent('Monday')
    }
    expect(reviewButton()).toBeDisabled()
    await pick('Sunday closes', '24')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(reviewButton()).toBeEnabled()
  })

  it('catches Saturday running into Sunday and opening hours that still overlap after a fix in a different day', async () => {
    mount()
    await pick('Sunday opens', '1')
    await pick('Saturday closes', '26')
    expect(group('Saturday').getByRole('alert')).toHaveTextContent(/overlap/i)
    expect(reviewButton()).toBeDisabled()
    await pick('Thursday closes', '20')
    expect(reviewButton()).toBeDisabled() // an unrelated edit does not clear it
    await pick('Sunday opens', '2')
    expect(reviewButton()).toBeEnabled()
  })

  it('never lets the blocked draft reach save_schedule', async () => {
    mount()
    await pick('Monday opens', '1')
    await pick('Sunday closes', '27')
    await userEvent.click(reviewButton())
    expect(screen.queryByRole('dialog', { name: 'Review changes' })).not.toBeInTheDocument()
    expect(saveSchedule).not.toHaveBeenCalled()
  })
})

describe('the copy row', () => {
  it('copies Monday\'s hours, a break included, to Mon–Fri and leaves the weekend alone', async () => {
    mount(replaceDays(week(), p(1, 8, 12), p(1, 14, 20)))
    await ready()
    await userEvent.selectOptions(screen.getByLabelText('Copy hours from'), 'Monday')
    await userEvent.click(screen.getByRole('button', { name: 'Copy to Mon–Fri' }))
    for (const name of ['Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      expect(screen.getByLabelText(`${name} opens`)).toHaveValue('8')
      expect(screen.getByLabelText(`${name} closes`)).toHaveValue('20')
      expect(group(name).getByText('Break 12 PM – 2 PM')).toBeInTheDocument()
    }
    expect(screen.getByLabelText('Saturday opens')).toHaveValue('6')
    await save()
    expect(saved()).toEqual(sorted([1, 2, 3, 4, 5].flatMap((d) => [p(d, 8, 12), p(d, 14, 20)]).concat([p(6, 6, 22), p(0, 6, 22)])))
  })

  it('copies Saturday\'s hours to Sat & Sun', async () => {
    mount(replaceDays(week(), p(6, 9, 23)))
    await ready()
    await userEvent.selectOptions(screen.getByLabelText('Copy hours from'), 'Saturday')
    await userEvent.click(screen.getByRole('button', { name: 'Copy to Sat & Sun' }))
    expect(screen.getByLabelText('Sunday opens')).toHaveValue('9')
    expect(screen.getByLabelText('Sunday closes')).toHaveValue('23')
    expect(screen.getByLabelText('Monday opens')).toHaveValue('6')
    await save()
    expect(saved()).toEqual(replaceDays(week(), p(6, 9, 23), p(0, 9, 23)))
  })

  it('copies a day to every day, an after-midnight closing included', async () => {
    mount(replaceDays(week(), p(5, 22, 26)))
    await ready()
    await userEvent.selectOptions(screen.getByLabelText('Copy hours from'), 'Friday')
    await userEvent.click(screen.getByRole('button', { name: 'Copy to every day' }))
    await save()
    expect(saved()).toEqual(week(22, 26))
  })

  it('copying a closed day closes the days it is copied to', async () => {
    mount(week().filter((x) => x.day_of_week !== 0))
    await ready()
    await userEvent.selectOptions(screen.getByLabelText('Copy hours from'), 'Sunday')
    await userEvent.click(screen.getByRole('button', { name: 'Copy to Sat & Sun' }))
    expect(screen.getByRole('switch', { name: 'Saturday open' })).not.toBeChecked()
    await save()
    expect(saved()).toEqual(week().filter((x) => x.day_of_week !== 0 && x.day_of_week !== 6))
  })

  it('is one row: the old per-day Copy buttons and checkbox panel are gone', async () => {
    mount()
    await ready()
    expect(screen.queryByRole('button', { name: /^Copy \w+ hours$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply copy' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Copy to / })).toHaveLength(3)
  })
})

describe('round trip: every shape the database accepts loads and saves unchanged', () => {
  const shapes: [string, SchedulePeriod[], { day: string; opens: string; closes: string }][] = [
    ['one break', [p(1, 6, 12), p(1, 14, 22)], { day: 'Monday', opens: '6', closes: '22' }],
    ['three periods', [p(2, 6, 10), p(2, 12, 14), p(2, 16, 22)], { day: 'Tuesday', opens: '6', closes: '22' }],
    ['touching periods, never merged', [p(3, 6, 12), p(3, 12, 22)], { day: 'Wednesday', opens: '6', closes: '22' }],
    ['closing after midnight', [p(5, 22, 26)], { day: 'Friday', opens: '22', closes: '26' }],
    ['a break and an after-midnight closing', [p(6, 10, 14), p(6, 18, 27)], { day: 'Saturday', opens: '10', closes: '27' }],
    ['24 hours, 12 AM to Midnight', [p(0, 0, 24)], { day: 'Sunday', opens: '0', closes: '24' }],
    ['a 24-hour period that starts at 5 AM', [p(1, 5, 29)], { day: 'Monday', opens: '5', closes: '29' }],
    ['one-hour periods', [p(2, 0, 1), p(2, 5, 6), p(2, 23, 24)], { day: 'Tuesday', opens: '0', closes: '24' }],
  ]

  it.each(shapes)('%s', async (_name, periods, expected) => {
    const venue = replaceDays(week(), ...periods)
    mount(venue)
    expect(await screen.findByLabelText(`${expected.day} opens`)).toHaveValue(expected.opens)
    expect(screen.getByLabelText(`${expected.day} closes`)).toHaveValue(expected.closes)
    expect(bar()).not.toBeInTheDocument() // loading changes nothing
    await pick('Thursday closes', '20') // an edit somewhere else
    await save()
    expect(saved()).toEqual(replaceDays(venue, p(4, 6, 20)))
  })
})
