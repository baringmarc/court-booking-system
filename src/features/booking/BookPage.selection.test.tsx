// T33.3: /book lets a player tap free slots on any courts and times; touching slots on one court make one run, a checkout
// holds at most 6 runs, and Continue carries the runs in the URL. The api.ts and catalog functions are mocked; hooks,
// React Query and the router are real. Slots are built from the page's own date, so nothing depends on the wall clock.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCourts, fetchPublicSchedule, fetchVenueSettings, type CourtWithPhotos, type PublicSchedulePeriod, type VenueSettings,
} from '../catalog/api'
import { addDays, formatDateLabel, todayInZone } from '../../lib/time'
import { fetchAvailability, fetchPlatformFee, type Slot } from './api'
import { BookPage } from './BookPage'
import { toCheckoutSearch, toRunsSearch } from './checkoutParams'
import { TOO_MANY_RUNS_MESSAGE } from './selection'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourts: vi.fn(),
  fetchPublicSchedule: vi.fn(),
  fetchVenueSettings: vi.fn(),
}))
vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchAvailability: vi.fn(), fetchPlatformFee: vi.fn() }))

const TZ = 'Asia/Manila'
const mk = (id: string, name: string, sport: string) =>
  ({ id, name, sport, description: '', is_active: true, court_photos: [] }) as unknown as CourtWithPhotos
const COURTS = [mk('A', 'Badminton 1', 'badminton'), mk('B', 'Badminton 2', 'badminton'), mk('C', 'Pickleball 1', 'pickleball')]

function schedule(): PublicSchedulePeriod[] {
  const today = todayInZone(TZ)
  return COURTS.flatMap((c) => Array.from({ length: 31 }, (_, i) => addDays(today, i)).map((date) => ({
    court_id: c.id, operating_date: date,
    period_start: new Date(`${date}T00:00:00+08:00`).toISOString(),
    period_end: new Date(`${addDays(date, 1)}T00:00:00+08:00`).toISOString(),
    booking_start: today, booking_end: addDays(today, 30),
  })))
}

const startOf = (date: string, hour: number) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+08:00`).toISOString()
const hourLabel = (h: number) => (h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`)
/** One free ₱350 slot per hour from `from` to `to` (exclusive) for a court, on `date`. */
function freeSlots(date: string, courtId: string, from: number, to: number, booked: number[] = []): Slot[] {
  return Array.from({ length: to - from }, (_, i) => from + i).map((h) => ({
    court_id: courtId, slot_start: startOf(date, h), slot_end: startOf(date, h + 1), price: 350,
    status: booked.includes(h) ? 'booked' : 'free', booker_first_name: null, open_play_session_id: null, block_key: null,
  }))
}
/** The accessible name of a grid slot button. */
const slotName = (court: string, h: number, suffix = '₱350') => `${court}, ${hourLabel(h)} – ${hourLabel(h + 1)}, ${suffix}`
const slotButton = (court: string, h: number) => screen.getByRole('button', { name: slotName(court, h) })
const pressed = (court: string, h: number) => slotButton(court, h).getAttribute('aria-pressed')
const bar = () => screen.getByRole('region', { name: 'Your selection' })

let client: QueryClient
const today = todayInZone(TZ)

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

function renderPage() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/book']}>
        <Routes>
          <Route path="/book" element={<BookPage />} />
          <Route path="/book/checkout" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

let hoursFrom = 10
let hoursTo = 15
let booked: Record<string, number[]> = {}

beforeEach(() => {
  hoursFrom = 10
  hoursTo = 15
  booked = {}
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: TZ, currency: 'PHP', booking_window_days: 30 } as VenueSettings)
  vi.mocked(fetchCourts).mockReset().mockResolvedValue(COURTS)
  vi.mocked(fetchPublicSchedule).mockReset().mockResolvedValue(schedule())
  vi.mocked(fetchPlatformFee).mockReset().mockResolvedValue(0)
  vi.mocked(fetchAvailability).mockReset().mockImplementation(async (date: string) =>
    ['A', 'B', 'C'].flatMap((id) => freeSlots(date, id, hoursFrom, hoursTo, booked[id] ?? [])))
})

async function tap(court: string, h: number) {
  await userEvent.click(await screen.findByRole('button', { name: slotName(court, h) }))
}

describe('BookPage tap-to-pick (T33.3)', () => {
  it('shows the new hint line under the date', async () => {
    renderPage()
    await screen.findByRole('button', { name: slotName('Badminton 1', 10) })
    expect(screen.getByText(`${formatDateLabel(today, TZ)} · Tap a time to select it, and tap more times on any court to add them. Prices are per hour.`)).toBeInTheDocument()
  })

  it('taps on two courts select both slots and the bar lists two times on two courts', async () => {
    renderPage()
    await tap('Badminton 1', 10)
    await tap('Badminton 2', 12)
    expect(pressed('Badminton 1', 10)).toBe('true')
    expect(pressed('Badminton 2', 12)).toBe('true')
    expect(bar().querySelector('strong')).toHaveTextContent(/^2 times · 2 courts$/)
    const items = within(within(bar()).getByRole('list', { name: 'Selected times' })).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Badminton 1, 10 AM–11 AM')
    expect(items[1]).toHaveTextContent('Badminton 2, 12 PM–1 PM')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('two times on one court: the hour between stays unselected (no filling the gap)', async () => {
    renderPage()
    await tap('Badminton 1', 10)
    await tap('Badminton 1', 13)
    expect(pressed('Badminton 1', 10)).toBe('true')
    expect(pressed('Badminton 1', 11)).toBe('false')
    expect(pressed('Badminton 1', 12)).toBe('false')
    expect(pressed('Badminton 1', 13)).toBe('true')
    expect(bar().querySelector('strong')).toHaveTextContent(/^2 times · 1 court$/)
  })

  it('touching taps on one court merge into one run: the bar looks like a single booking', async () => {
    renderPage()
    await tap('Badminton 1', 10)
    await tap('Badminton 1', 11)
    expect(bar().querySelector('strong')).toHaveTextContent(/^Badminton 1$/)
    expect(bar()).toHaveTextContent('10 AM–12 PM · 2 hours')
    expect(within(bar()).queryByRole('list', { name: 'Selected times' })).not.toBeInTheDocument()
  })

  it('tapping a picked slot removes it, and a middle slot splits its run in two', async () => {
    renderPage()
    await tap('Badminton 1', 10)
    await tap('Badminton 1', 11)
    await tap('Badminton 1', 12)
    await tap('Badminton 1', 11)
    expect(pressed('Badminton 1', 11)).toBe('false')
    expect(bar().querySelector('strong')).toHaveTextContent(/^2 times · 1 court$/)
    await tap('Badminton 1', 10)
    await tap('Badminton 1', 12)
    expect(screen.queryByRole('region', { name: 'Your selection' })).not.toBeInTheDocument()
  })

  it("the bar's Remove button drops that run and keeps the other", async () => {
    renderPage()
    await tap('Badminton 1', 10)
    await tap('Badminton 2', 12)
    await userEvent.click(within(bar()).getByRole('button', { name: 'Remove Badminton 1, 10 AM–11 AM' }))
    expect(pressed('Badminton 1', 10)).toBe('false')
    expect(pressed('Badminton 2', 12)).toBe('true')
    expect(bar().querySelector('strong')).toHaveTextContent(/^Badminton 2$/)
  })

  it('Clear drops every pick', async () => {
    renderPage()
    await tap('Badminton 1', 10)
    await tap('Badminton 2', 12)
    await userEvent.click(within(bar()).getByRole('button', { name: 'Clear' }))
    expect(screen.queryByRole('region', { name: 'Your selection' })).not.toBeInTheDocument()
    expect(pressed('Badminton 1', 10)).toBe('false')
    expect(pressed('Badminton 2', 12)).toBe('false')
  })
})

describe('BookPage date and sport changes (T33.3)', () => {
  it('changing the date clears the selection', async () => {
    renderPage()
    await tap('Badminton 1', 10)
    await tap('Badminton 2', 12)
    const date = await screen.findByRole('group', { name: 'Date' })
    const tiles = within(date).getAllByRole('button').filter((b) => b.classList.contains('date-tile'))
    await userEvent.click(tiles[1])
    await screen.findByRole('button', { name: slotName('Badminton 1', 10) })
    expect(screen.queryByRole('region', { name: 'Your selection' })).not.toBeInTheDocument()
    expect(pressed('Badminton 1', 10)).toBe('false')
  })

  it('switching the sport tab keeps the selection: the bar still lists picks on the other sport, and more can be added', async () => {
    renderPage()
    await tap('Badminton 1', 10)
    await userEvent.click(within(await screen.findByRole('group', { name: 'Sport' })).getByRole('button', { name: 'Pickleball' }))
    await tap('Pickleball 1', 12)
    expect(bar().querySelector('strong')).toHaveTextContent(/^2 times · 2 courts$/)
    expect(within(bar()).getByRole('button', { name: 'Remove Badminton 1, 10 AM–11 AM' })).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('group', { name: 'Sport' })).getByRole('button', { name: 'Badminton' }))
    expect(await screen.findByRole('button', { name: slotName('Badminton 1', 10) })).toHaveAttribute('aria-pressed', 'true')
    expect(bar().querySelector('strong')).toHaveTextContent(/^2 times · 2 courts$/)
  })
})

describe('BookPage run cap (T33.3)', () => {
  beforeEach(() => {
    hoursFrom = 8
    hoursTo = 21
  })

  async function pickSix() {
    for (const h of [8, 10, 12, 14, 16, 18]) await tap('Badminton 1', h)
  }

  it('a 7th separate run shows the alert, leaves the selection alone and the next tap clears the alert', async () => {
    renderPage()
    await pickSix()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await tap('Badminton 1', 20)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveClass('alert', 'alert-error')
    expect(alert).toHaveTextContent(TOO_MANY_RUNS_MESSAGE)
    expect(alert).toHaveTextContent('You can book up to 6 separate times in one checkout.')
    expect(pressed('Badminton 1', 20)).toBe('false')
    expect(bar().querySelector('strong')).toHaveTextContent(/^6 times · 1 court$/)
    // A tap that extends an existing run is allowed at 6 runs, and clears the alert.
    await tap('Badminton 1', 19)
    expect(pressed('Badminton 1', 19)).toBe('true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a tap that joins two runs is allowed at 6 runs', async () => {
    renderPage()
    await pickSix()
    await tap('Badminton 1', 9)
    expect(pressed('Badminton 1', 9)).toBe('true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(bar().querySelector('strong')).toHaveTextContent(/^5 times · 1 court$/)
  })

  it('removing a middle slot that would make a 7th run is refused with the same alert', async () => {
    renderPage()
    for (const h of [8, 10, 11, 12, 14, 16, 18, 20]) await tap('Badminton 1', h)
    await tap('Badminton 1', 11)
    expect(screen.getByRole('alert')).toHaveTextContent(TOO_MANY_RUNS_MESSAGE)
    expect(pressed('Badminton 1', 11)).toBe('true')
  })

  it('counts runs across courts too', async () => {
    renderPage()
    await tap('Badminton 1', 8)
    await tap('Badminton 1', 10)
    await tap('Badminton 1', 12)
    await tap('Badminton 2', 8)
    await tap('Badminton 2', 10)
    await tap('Badminton 2', 12)
    await tap('Badminton 2', 15)
    expect(screen.getByRole('alert')).toHaveTextContent(TOO_MANY_RUNS_MESSAGE)
    expect(pressed('Badminton 2', 15)).toBe('false')
    expect(bar().querySelector('strong')).toHaveTextContent(/^6 times · 2 courts$/)
  })

  it('Clear removes the alert', async () => {
    renderPage()
    await pickSix()
    await tap('Badminton 1', 20)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await userEvent.click(within(bar()).getByRole('button', { name: 'Clear' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('changing the date removes the alert', async () => {
    renderPage()
    await pickSix()
    await tap('Badminton 1', 20)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    const date = screen.getByRole('group', { name: 'Date' })
    await userEvent.click(within(date).getAllByRole('button').filter((b) => b.classList.contains('date-tile'))[1])
    await screen.findByRole('button', { name: slotName('Badminton 1', 20) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('BookPage slots taken while picking (T33.3)', () => {
  async function refetchWith(next: Record<string, number[]>) {
    booked = next
    await act(() => client.invalidateQueries())
  }

  it('names one taken pick, keeps the others selected', async () => {
    renderPage()
    await tap('Badminton 1', 12)
    await tap('Badminton 2', 13)
    await refetchWith({ B: [13] })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveClass('alert', 'alert-error')
    expect(alert).toHaveTextContent('Badminton 2 at 1 PM is no longer available. Please choose again.')
    expect(await screen.findByRole('button', { name: slotName('Badminton 2', 13, 'Booked') })).toBeDisabled()
    expect(pressed('Badminton 1', 12)).toBe('true')
    expect(bar().querySelector('strong')).toHaveTextContent(/^Badminton 1$/)
  })

  it('names several taken picks joined with "and", with "are"', async () => {
    renderPage()
    await tap('Badminton 1', 12)
    await tap('Badminton 2', 13)
    await tap('Badminton 2', 10)
    await refetchWith({ A: [12], B: [13] })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Badminton 1 at 12 PM and Badminton 2 at 1 PM are no longer available. Please choose again.',
    )
    expect(pressed('Badminton 2', 10)).toBe('true')
  })

  it('a slot next to a taken one stays selected (a pick is never dropped because a neighbour went)', async () => {
    renderPage()
    await tap('Badminton 1', 10)
    await tap('Badminton 1', 11)
    await tap('Badminton 1', 12)
    await refetchWith({ A: [12] })
    expect(await screen.findByRole('alert')).toHaveTextContent('Badminton 1 at 12 PM is no longer available. Please choose again.')
    expect(pressed('Badminton 1', 10)).toBe('true')
    expect(pressed('Badminton 1', 11)).toBe('true')
    expect(bar()).toHaveTextContent('10 AM–12 PM · 2 hours')
  })
})

describe('BookPage Continue (T33.3)', () => {
  const start = (h: number) => startOf(today, h)

  it('one run keeps the old checkout URL (court, start, slots)', async () => {
    renderPage()
    await tap('Badminton 1', 10)
    await tap('Badminton 1', 11)
    await userEvent.click(within(bar()).getByRole('button', { name: 'Continue' }))
    expect((await screen.findByTestId('where')).textContent).toBe(`/book/checkout?${toCheckoutSearch({ courtId: 'A', start: start(10), slots: 2 })}`)
  })

  it('two courts: one run param each, ordered by first start', async () => {
    renderPage()
    await tap('Badminton 2', 12)
    await tap('Badminton 1', 10)
    await userEvent.click(within(bar()).getByRole('button', { name: 'Continue' }))
    expect((await screen.findByTestId('where')).textContent).toBe(
      `/book/checkout?${toRunsSearch([{ courtId: 'A', start: start(10), slots: 1 }, { courtId: 'B', start: start(12), slots: 1 }])}`,
    )
  })

  it('a merged run and a separate time on one court give two runs with the slot counts', async () => {
    renderPage()
    await tap('Badminton 1', 14)
    await tap('Badminton 1', 10)
    await tap('Badminton 1', 11)
    await userEvent.click(within(bar()).getByRole('button', { name: 'Continue' }))
    expect((await screen.findByTestId('where')).textContent).toBe(
      `/book/checkout?${toRunsSearch([{ courtId: 'A', start: start(10), slots: 2 }, { courtId: 'A', start: start(14), slots: 1 }])}`,
    )
  })

  it('runs starting together are ordered by court id', async () => {
    renderPage()
    await tap('Badminton 2', 10)
    await tap('Badminton 1', 10)
    await userEvent.click(within(bar()).getByRole('button', { name: 'Continue' }))
    expect((await screen.findByTestId('where')).textContent).toBe(
      `/book/checkout?${toRunsSearch([{ courtId: 'A', start: start(10), slots: 1 }, { courtId: 'B', start: start(10), slots: 1 }])}`,
    )
  })
})
