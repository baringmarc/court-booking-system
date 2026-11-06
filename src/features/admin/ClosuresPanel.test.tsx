// T17.33: the Closures form. "Today" is Fri 2030-01-04, 10:30 AM in Manila (UTC+8, so 02:30 UTC). Closures are made
// through the existing blackout writes; the form only warns about bookings and open play already in the time.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import {
  createBlackout, deleteBlackout, fetchCourts, fetchUpcomingBlackouts, fetchVenueSettings,
  type Blackout, type CourtWithPhotos, type VenueSettings,
} from '../catalog/api'
import { fetchClosureConflicts, fetchSchedule } from './api'
import { ClosuresPanel } from './ClosuresPanel'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createBlackout: vi.fn(),
  deleteBlackout: vi.fn(),
  fetchCourts: vi.fn(),
  fetchUpcomingBlackouts: vi.fn(),
  fetchVenueSettings: vi.fn(),
}))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSchedule: vi.fn(),
  fetchClosureConflicts: vi.fn(),
}))

type Period = { day_of_week: number; start_minute: number; end_minute: number }

const court = (id: string, name: string): CourtWithPhotos => ({
  id, name, sport: 'tennis', default_hourly_rate: 700, is_active: true, sort_order: 1, court_photos: [],
  venue_id: 'v1', description: '', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
})
const allDays = (start: number, end: number): Period[] => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_minute: start * 60, end_minute: end * 60 }))
const noConflicts = { bookings: [], sessions: [] }

/** Venue open 6 AM–10 PM; Court One follows it, Court Two keeps its own 8 AM–11 PM. */
function schedule(over: { venue?: Period[] } = {}) {
  return {
    venue_id: 'v1',
    schedule_revision: 1,
    venue_periods: over.venue ?? allDays(6, 22),
    courts: [
      { court_id: 'c1', schedule_mode: 'inherit', schedule_revision: 0, periods: [], rates: [] },
      { court_id: 'c2', schedule_mode: 'custom', schedule_revision: 0, periods: allDays(8, 23), rates: [] },
    ],
  }
}

const closure = (id: string, courtId: string | null, startsAt: string, endsAt: string, reason: string): Blackout =>
  ({ id, court_id: courtId, starts_at: startsAt, ends_at: endsAt, reason, venue_id: 'v1', created_at: '2030-01-01T00:00:00Z', created_by: null })

function mount(over: { schedule?: ReturnType<typeof schedule>; blackouts?: Blackout[] } = {}) {
  vi.mocked(fetchSchedule).mockResolvedValue((over.schedule ?? schedule()) as never)
  vi.mocked(fetchUpcomingBlackouts).mockResolvedValue(over.blackouts ?? [])
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter><ClosuresPanel /></MemoryRouter></QueryClientProvider>)
}

const group = (name: string) => within(screen.getByRole('group', { name }))
const summary = () => screen.getByRole('status', { name: 'Closure summary' })
const ready = async () => { await screen.findByRole('option', { name: 'Court Two' }) }
const quick = async (name: string) => { await ready(); await userEvent.click(group('Which days').getByRole('button', { name })) }
/** Court One follows the venue's hours, so its closure runs exactly the venue's operating day. */
const courtOne = () => userEvent.selectOptions(screen.getByRole('combobox', { name: 'Court' }), 'Court One')
const add = () => userEvent.click(screen.getByRole('button', { name: 'Add closure' }))
const payloads = () => vi.mocked(createBlackout).mock.calls.map((c) => c[0])

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2030-01-04T02:30:00.000Z'))
  vi.mocked(fetchCourts).mockReset().mockResolvedValue([court('c1', 'Court One'), court('c2', 'Court Two')])
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila' } as VenueSettings)
  vi.mocked(fetchSchedule).mockReset()
  vi.mocked(fetchUpcomingBlackouts).mockReset().mockResolvedValue([])
  vi.mocked(createBlackout).mockReset().mockResolvedValue({} as Awaited<ReturnType<typeof createBlackout>>)
  vi.mocked(deleteBlackout).mockReset().mockResolvedValue(undefined)
  vi.mocked(fetchClosureConflicts).mockReset().mockResolvedValue(noConflicts)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the form (T17.33)', () => {
  it('is named Closures, says the venue timezone, and offers the court select with All courts first', async () => {
    mount()
    expect(await screen.findByRole('heading', { level: 2, name: 'Closures' })).toBeInTheDocument()
    expect((await screen.findAllByText(/Asia\/Manila/)).length).toBeGreaterThan(0)
    await ready()
    const select = screen.getByRole('combobox', { name: 'Court' })
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['All courts', 'Court One', 'Court Two'])
  })

  it('never says blackout or Temporary Closures', async () => {
    mount({ blackouts: [closure('b1', null, '2030-01-05T00:00:00.000Z', '2030-01-05T02:00:00.000Z', 'Holiday')] })
    await screen.findByRole('button', { name: 'Remove closure: All courts' })
    expect(document.body.textContent).not.toMatch(/blackout|Temporary Closures/i)
  })

  it('offers Today, Tomorrow, This weekend and Pick dates, with Today chosen and All day ticked by default', async () => {
    mount()
    await ready()
    const names = group('Which days').getAllByRole('button').map((b) => b.textContent)
    expect(names).toEqual(['Today', 'Tomorrow', 'This weekend', 'Pick dates'])
    expect(group('Which days').getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')
    expect(group('Which days').getByRole('button', { name: 'Pick dates' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('checkbox', { name: 'All day' })).toBeChecked()
    expect(screen.queryByRole('group', { name: 'Starts at' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Starts on' })).not.toBeInTheDocument()
  })
})

describe('quick picks and All day (T17.33)', () => {
  it('Today closes the whole operating day: 6 AM to 10 PM tonight, for All courts as court_id null', async () => {
    mount()
    await ready()
    await courtOne()
    await add()
    expect(await screen.findAllByText('Fri, Jan 4, 6:00 AM – Fri, Jan 4, 10:00 PM')).not.toHaveLength(0)
    expect(payloads()).toEqual([{ court_id: 'c1', starts_at: '2030-01-03T22:00:00.000Z', ends_at: '2030-01-04T14:00:00.000Z', reason: '' }])
  })

  it('Tomorrow closes tomorrow\'s operating day, and marks only itself pressed', async () => {
    mount()
    await quick('Tomorrow')
    await courtOne()
    expect(group('Which days').getByRole('button', { name: 'Tomorrow' })).toHaveAttribute('aria-pressed', 'true')
    expect(group('Which days').getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'false')
    await within(summary()).findByText('Sat, Jan 5, 6:00 AM – Sat, Jan 5, 10:00 PM')
    await add()
    expect(payloads()).toEqual([{ court_id: 'c1', starts_at: '2030-01-04T22:00:00.000Z', ends_at: '2030-01-05T14:00:00.000Z', reason: '' }])
  })

  it('This weekend (a Friday) adds one closure for Saturday and one for Sunday, one summary line each', async () => {
    mount()
    await quick('This weekend')
    await courtOne()
    expect(group('Which days').getByRole('button', { name: 'This weekend' })).toHaveAttribute('aria-pressed', 'true')
    const lines = summary()
    await within(lines).findByText('Sat, Jan 5, 6:00 AM – Sat, Jan 5, 10:00 PM')
    expect(within(lines).getByText('Sun, Jan 6, 6:00 AM – Sun, Jan 6, 10:00 PM')).toBeInTheDocument()
    await add()
    expect(payloads()).toEqual([
      { court_id: 'c1', starts_at: '2030-01-04T22:00:00.000Z', ends_at: '2030-01-05T14:00:00.000Z', reason: '' },
      { court_id: 'c1', starts_at: '2030-01-05T22:00:00.000Z', ends_at: '2030-01-06T14:00:00.000Z', reason: '' },
    ])
  })

  it('Pick dates shows Starts on and Ends on, and a range of two dates makes one closure per date', async () => {
    mount()
    await quick('Pick dates')
    await courtOne()
    expect(group('Which days').getByRole('button', { name: 'Pick dates' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(group('Ends on').getByRole('button', { name: 'Tomorrow' }))
    await add()
    expect(payloads()).toEqual([
      { court_id: 'c1', starts_at: '2030-01-03T22:00:00.000Z', ends_at: '2030-01-04T14:00:00.000Z', reason: '' },
      { court_id: 'c1', starts_at: '2030-01-04T22:00:00.000Z', ends_at: '2030-01-05T14:00:00.000Z', reason: '' },
    ])
  })

  it('an overnight operating day (6 PM to 2 AM) closes until 2 AM the next calendar date', async () => {
    const overnight = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_minute: 1080, end_minute: 1560 }))
    mount({ schedule: schedule({ venue: overnight }) })
    await ready()
    await courtOne()
    await within(summary()).findByText('Fri, Jan 4, 6:00 PM – Sat, Jan 5, 2:00 AM')
    await add()
    expect(payloads()).toEqual([{ court_id: 'c1', starts_at: '2030-01-04T10:00:00.000Z', ends_at: '2030-01-04T18:00:00.000Z', reason: '' }])
  })

  it('a specific court closes its own hours; Court One follows the venue\'s, Court Two has 8 AM to 11 PM', async () => {
    mount()
    await ready()
    const select = screen.getByRole('combobox', { name: 'Court' })
    await userEvent.selectOptions(select, 'Court Two')
    await within(summary()).findByText('Fri, Jan 4, 8:00 AM – Fri, Jan 4, 11:00 PM')
    await add()
    await userEvent.selectOptions(select, 'Court One')
    await within(summary()).findByText('Fri, Jan 4, 6:00 AM – Fri, Jan 4, 10:00 PM')
    await add()
    expect(payloads()).toEqual([
      { court_id: 'c2', starts_at: '2030-01-04T00:00:00.000Z', ends_at: '2030-01-04T15:00:00.000Z', reason: '' },
      { court_id: 'c1', starts_at: '2030-01-03T22:00:00.000Z', ends_at: '2030-01-04T14:00:00.000Z', reason: '' },
    ])
  })

  it('All courts runs from the earliest opening to the latest closing of any court (6 AM to 11 PM)', async () => {
    mount()
    await ready()
    await within(summary()).findByText('Fri, Jan 4, 6:00 AM – Fri, Jan 4, 11:00 PM')
    await add()
    expect(payloads()).toEqual([{ court_id: null, starts_at: '2030-01-03T22:00:00.000Z', ends_at: '2030-01-04T15:00:00.000Z', reason: '' }])
  })

  it('skips a date nobody is open on and says "Closed all day already." for it', async () => {
    const noSunday = allDays(6, 22).filter((p) => p.day_of_week !== 0)
    const data = schedule({ venue: noSunday })
    data.courts[1].periods = allDays(8, 23).filter((p) => p.day_of_week !== 0)
    mount({ schedule: data })
    await quick('This weekend')
    await within(summary()).findByText(/Closed all day already\./)
    expect(within(summary()).getAllByText(/Closed all day already\./)).toHaveLength(1)
    await add()
    expect(payloads()).toEqual([{ court_id: null, starts_at: '2030-01-04T22:00:00.000Z', ends_at: '2030-01-05T15:00:00.000Z', reason: '' }])
  })
})

describe('timed closures (T17.33)', () => {
  const untick = async () => { await ready(); await userEvent.click(screen.getByRole('checkbox', { name: 'All day' })) }

  it('unticking All day shows Starts at and Ends at', async () => {
    mount()
    await untick()
    expect(screen.getByRole('checkbox', { name: 'All day' })).not.toBeChecked()
    expect(screen.getByRole('group', { name: 'Starts at' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Ends at' })).toBeInTheDocument()
  })

  it('does not offer hours already over today, keeps the hour in progress, and ends only after the start', async () => {
    mount()
    await untick()
    const starts = screen.getByRole('group', { name: 'Starts at' })
    expect(within(starts).queryByRole('radio', { name: '9 AM' })).toBeNull()
    expect(within(starts).getByRole('radio', { name: '10 AM' })).toBeInTheDocument()
    await userEvent.click(within(starts).getByRole('radio', { name: '9 PM' }))
    expect(group('Ends at').getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['10 PM', '11 PM', 'Midnight'])
  })

  it('offers all of tomorrow\'s hours', async () => {
    mount()
    await quick('Tomorrow')
    await userEvent.click(screen.getByRole('checkbox', { name: 'All day' }))
    expect(within(screen.getByRole('group', { name: 'Starts at' })).getByRole('radio', { name: '12 AM' })).toBeInTheDocument()
  })

  it('asks for the start, then the end, and creates nothing until both are chosen', async () => {
    mount()
    await untick()
    await add()
    expect(screen.getByRole('alert')).toHaveTextContent('Choose when the closure starts.')
    await userEvent.click(group('Starts at').getByRole('radio', { name: '9 PM' }))
    await add()
    expect(screen.getByRole('alert')).toHaveTextContent('Choose when it ends.')
    expect(createBlackout).not.toHaveBeenCalled()
  })

  it('adds one closure from the start hour to the end hour, states the range, then resets the hours', async () => {
    mount()
    await quick('Tomorrow')
    await userEvent.click(screen.getByRole('checkbox', { name: 'All day' }))
    await userEvent.click(group('Starts at').getByRole('radio', { name: '8 AM' }))
    await userEvent.click(group('Ends at').getByRole('radio', { name: 'Midnight' }))
    await within(summary()).findByText('Sat, Jan 5, 8:00 AM – Sun, Jan 6, 12:00 AM')
    await add()
    expect(payloads()).toEqual([{ court_id: null, starts_at: '2030-01-05T00:00:00.000Z', ends_at: '2030-01-05T16:00:00.000Z', reason: '' }])
    await vi.waitFor(() => expect(group('Starts at').getByRole('radio', { name: '8 AM' })).not.toBeChecked())
  })
})

describe('the summary (T17.33)', () => {
  const booking = { id: 'bk1', reference_code: 'CB-ABC123', court_name: 'Court Two', slot_start: '2030-01-04T02:00:00.000Z', slot_end: '2030-01-04T03:00:00.000Z', guest_name: 'Ana' }
  const session = { id: 'os1', title: 'Friday Social', starts_at: '2030-01-04T10:00:00.000Z', ends_at: '2030-01-04T12:00:00.000Z' }

  it('is a status region named Closure summary', async () => {
    mount()
    await ready()
    expect(summary()).toBeInTheDocument()
  })

  it('asks for the conflicts of the real range and court', async () => {
    mount()
    await ready()
    await screen.findByText('No bookings or open play in this time.')
    expect(vi.mocked(fetchClosureConflicts).mock.calls.at(-1)?.slice(0, 3)).toEqual(['2030-01-03T22:00:00.000Z', '2030-01-04T15:00:00.000Z', null])
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Court' }), 'Court Two')
    await vi.waitFor(() => expect(vi.mocked(fetchClosureConflicts).mock.calls.at(-1)?.slice(0, 3)).toEqual(['2030-01-04T00:00:00.000Z', '2030-01-04T15:00:00.000Z', 'c2']))
  })

  it('says "No bookings or open play in this time." when nothing is booked, and shows no warning heading', async () => {
    mount()
    await ready()
    expect(await within(summary()).findByText('No bookings or open play in this time.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Already booked in this time' })).not.toBeInTheDocument()
  })

  it('lists bookings and open play already in the time, links each, and says nothing is cancelled', async () => {
    vi.mocked(fetchClosureConflicts).mockResolvedValue({ bookings: [booking], sessions: [session] })
    mount()
    await ready()
    expect(await within(summary()).findByRole('heading', { name: 'Already booked in this time' })).toBeInTheDocument()
    const bookingLink = within(summary()).getByRole('link', { name: /CB-ABC123/ })
    expect(bookingLink).toHaveTextContent('Court Two')
    expect(bookingLink.getAttribute('href')).toContain('/admin/bookings')
    expect(bookingLink.getAttribute('href')).toContain('booking=bk1')
    const sessionLink = within(summary()).getByRole('link', { name: /Friday Social/ })
    expect(sessionLink.getAttribute('href')).toContain('/admin/open-play')
    expect(within(summary()).getByText('They stay booked. Nothing is cancelled or moved.')).toBeInTheDocument()
    expect(within(summary()).queryByText('No bookings or open play in this time.')).not.toBeInTheDocument()
  })

  it('adding the closure still cancels and moves nothing: only the closure is written', async () => {
    vi.mocked(fetchClosureConflicts).mockResolvedValue({ bookings: [booking], sessions: [] })
    mount()
    await ready()
    await within(summary()).findByRole('link', { name: /CB-ABC123/ })
    await add()
    expect(createBlackout).toHaveBeenCalledTimes(1)
  })
})

describe('the reason (T17.33)', () => {
  const input = () => screen.getByLabelText('Reason (staff only)')
  const chip = (name: string) => within(screen.getByRole('group', { name: 'Reason' })).getByRole('button', { name })

  it('offers Holiday, Maintenance, Private event and Other, a staff-only field and the player hint', async () => {
    mount()
    await ready()
    expect(within(screen.getByRole('group', { name: 'Reason' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Holiday', 'Maintenance', 'Private event', 'Other'])
    expect(input()).toHaveValue('')
    expect(screen.getByText('Players only see “Closed”.')).toBeInTheDocument()
  })

  it('a chip fills the field with its word, and the reason is saved then cleared', async () => {
    mount()
    await ready()
    await userEvent.click(chip('Maintenance'))
    expect(input()).toHaveValue('Maintenance')
    await userEvent.click(chip('Private event'))
    expect(input()).toHaveValue('Private event')
    await add()
    expect(payloads()[0].reason).toBe('Private event')
    await vi.waitFor(() => expect(input()).toHaveValue(''))
  })

  it('Holiday fills Holiday; Other clears the field and focuses it', async () => {
    mount()
    await ready()
    await userEvent.click(chip('Holiday'))
    expect(input()).toHaveValue('Holiday')
    await userEvent.click(chip('Other'))
    expect(input()).toHaveValue('')
    expect(input()).toHaveFocus()
  })

  it('keeps typed text as the staff note', async () => {
    mount()
    await ready()
    await userEvent.type(input(), 'Court resurfacing')
    await add()
    expect(payloads()[0].reason).toBe('Court resurfacing')
  })

  it('shows the error when adding fails', async () => {
    vi.mocked(createBlackout).mockRejectedValue(new ApiError('boom add', 'P0001'))
    mount()
    await ready()
    await add()
    expect(await screen.findByRole('alert')).toHaveTextContent('boom add')
  })
})

describe('upcoming closures (T17.33)', () => {
  const rows = () => [
    closure('b1', 'c2', '2030-01-05T00:00:00.000Z', '2030-01-05T04:00:00.000Z', 'Floor repair'),
    closure('b2', null, '2030-01-06T00:00:00.000Z', '2030-01-06T14:00:00.000Z', 'Holiday'),
  ]

  it('lists each closure with its court (or All courts), its range and its reason', async () => {
    mount({ blackouts: rows() })
    expect(await screen.findByRole('heading', { level: 3, name: 'Upcoming closures' })).toBeInTheDocument()
    const first = (await screen.findByRole('button', { name: 'Remove closure: Court Two' })).closest('li')!
    expect(first).toHaveTextContent('Court Two')
    expect(first).toHaveTextContent('Sat, Jan 5, 8:00 AM')
    expect(first).toHaveTextContent('Sat, Jan 5, 12:00 PM')
    expect(first).toHaveTextContent('Floor repair')
    const second = screen.getByRole('button', { name: 'Remove closure: All courts' }).closest('li')!
    expect(second).toHaveTextContent('Holiday')
  })

  it('says "No upcoming closures." when there are none', async () => {
    mount()
    expect(await screen.findByText('No upcoming closures.')).toBeInTheDocument()
  })

  it('shows a loader while loading', async () => {
    vi.mocked(fetchUpcomingBlackouts).mockReturnValue(new Promise(() => {}))
    vi.mocked(fetchSchedule).mockResolvedValue(schedule() as never)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter><ClosuresPanel /></MemoryRouter></QueryClientProvider>)
    expect(await screen.findAllByText('Loading…')).not.toHaveLength(0)
  })

  it('shows the error with Try again that refetches', async () => {
    vi.mocked(fetchUpcomingBlackouts).mockRejectedValueOnce(new ApiError('boom upcoming', 'P0001'))
    mount({ blackouts: rows() })
    expect(await screen.findByText(/boom upcoming/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Remove closure: Court Two' })).toBeInTheDocument()
  })

  describe('removing', () => {
    const open = async () => {
      const opener = await screen.findByRole('button', { name: 'Remove closure: Court Two' })
      await userEvent.click(opener)
      return opener
    }

    it('asks in the app\'s own dialog and never uses window.confirm', async () => {
      const confirm = vi.spyOn(window, 'confirm')
      mount({ blackouts: rows() })
      await open()
      const dialog = await screen.findByRole('dialog', { name: 'Remove this closure?' })
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(within(dialog).getByText('The time will become bookable again.')).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Keep closure' })).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Remove closure' })).toBeInTheDocument()
      expect(deleteBlackout).not.toHaveBeenCalled()
      expect(confirm).not.toHaveBeenCalled()
    })

    it('Keep closure closes the dialog, deletes nothing and returns focus to the Remove button', async () => {
      mount({ blackouts: rows() })
      const opener = await open()
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Remove this closure?' })).getByRole('button', { name: 'Keep closure' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(deleteBlackout).not.toHaveBeenCalled()
      expect(opener).toHaveFocus()
    })

    it('Escape closes the dialog, deletes nothing and returns focus to the Remove button', async () => {
      mount({ blackouts: rows() })
      const opener = await open()
      await screen.findByRole('dialog', { name: 'Remove this closure?' })
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(deleteBlackout).not.toHaveBeenCalled()
      expect(opener).toHaveFocus()
    })

    it('Remove closure deletes exactly that closure and closes the dialog', async () => {
      const confirm = vi.spyOn(window, 'confirm')
      mount({ blackouts: rows() })
      await open()
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Remove this closure?' })).getByRole('button', { name: 'Remove closure' }))
      await vi.waitFor(() => expect(deleteBlackout).toHaveBeenCalledTimes(1))
      expect(vi.mocked(deleteBlackout).mock.calls[0][0]).toBe('b1')
      await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(confirm).not.toHaveBeenCalled()
    })
  })
})
