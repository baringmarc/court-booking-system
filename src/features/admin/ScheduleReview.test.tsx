// T17.31: the sticky save bar, Discard, the Review changes dialog (plain-word list and affected bookings), conflict and the
// leave-page guard. Hours and prices are one draft and one save_schedule call, whichever tab is open.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { formatDateTimeInZone } from '../../lib/time'
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

type Period = { day_of_week: number; start_minute: number; end_minute: number }
type Rate = { day_of_week: number; start_hour: number; price: number }
type Impact = {
  from: string; to: string
  bookings: { total: number; items: { booking_id: string; court_id: string; starts_at: string; ends_at: string; status: string }[] }
  open_play: { total: number; items: { session_id: string; court_id: string; title: string; starts_at: string; ends_at: string }[] }
}

const TZ = 'Asia/Manila'
const court = (id: string, name: string): CourtWithPhotos => ({
  id, name, sport: 'tennis', default_hourly_rate: 700, is_active: true, sort_order: 1, court_photos: [],
  venue_id: 'v1', description: '', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
})
const allDays = (start = 360, end = 1320): Period[] => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_minute: start, end_minute: end }))
const noImpact = (): Impact => ({ from: '2026-11-05', to: '2027-02-03', bookings: { total: 0, items: [] }, open_play: { total: 0, items: [] } })

function scheduleData(over: { revision?: number; venue?: Period[] } = {}) {
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

function mount(entry = '/admin/schedule') {
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

const HOURS = /^Opening hours/
const PRICES = /^Prices/
const CLOSURES = /^Closures/
const openTab = async (name: RegExp) => userEvent.click(await screen.findByRole('tab', { name }))
const pick = async (label: string, value: string) => userEvent.selectOptions(await screen.findByLabelText(label), value)
/** Opens a court's own-hours view ("Editing Court N only"); Back to all courts returns to the venue's table. */
const editCourt = async (name: string) => userEvent.click(await within(await screen.findByRole('region', { name: 'Courts with different hours' })).findByRole('button', { name: new RegExp(`^Edit hours for ${name}`) }))
const backToAll = async () => userEvent.click(await screen.findByRole('button', { name: 'Back to all courts' }))
/** Gives a court on the opening hours its own hours (a copy of the venue's); this opens its edit view. */
const giveHours = async (name: string) => {
  await userEvent.selectOptions(await screen.findByLabelText('Choose a court'), name)
  await userEvent.click(screen.getByRole('button', { name: 'Give this court different hours' }))
}
const addBreak = async (day: string) => userEvent.click(within(await screen.findByRole('group', { name: day })).getByRole('button', { name: /Add a break/ }))
const bar = () => screen.queryByRole('region', { name: 'Unsaved changes' })
const barButton = (name: string) => within(screen.getByRole('region', { name: 'Unsaved changes' })).getByRole('button', { name })
const reviewDialog = () => screen.findByRole('dialog', { name: 'Review changes' })
const openReview = async () => {
  await userEvent.click(barButton('Review & save'))
  return reviewDialog()
}
const lines = (dialog: HTMLElement) => within(dialog).getAllByRole('listitem').map((li) => li.textContent)
const saveFromDialog = async () => {
  await userEvent.click(within(await openReview()).getByRole('button', { name: 'Save changes' }))
}
const lastChanges = () => vi.mocked(saveSchedule).mock.calls.at(-1)![1] as Record<string, unknown[] | undefined>

/** Venue Monday 6 AM – 10 PM becomes 6 AM – 12 PM: one hours change. */
const editMonday = async () => pick('Monday closes', '12')
/** A new override for Court Two on Monday 6 AM – 7 AM. */
async function addRate(price: string, from = '6', to = '7') {
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
  previewMock.mockReset()
  previewMock.mockResolvedValue(noImpact())
  vi.mocked(fetchSchedule).mockReset()
  vi.mocked(saveSchedule).mockReset().mockResolvedValue({ venue_id: 'v1', schedule_revision: 8 } as never)
  vi.mocked(fetchCourts).mockReset()
  vi.mocked(fetchUpcomingBlackouts).mockReset().mockResolvedValue([])
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: TZ } as VenueSettings)
})

describe('the save bar', () => {
  it('is not rendered when nothing changed, and the old controls are gone', async () => {
    mount()
    await screen.findByRole('switch', { name: 'Monday open' })
    expect(bar()).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save schedule' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revert unsaved changes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Pending changes' })).not.toBeInTheDocument()
    expect(screen.queryByText('You have unsaved changes.')).not.toBeInTheDocument()
  })

  it('appears on the first change with "1 unsaved change", Discard and Review & save, and none of the old controls', async () => {
    mount()
    await editMonday()
    const region = screen.getByRole('region', { name: 'Unsaved changes' })
    expect(region).toHaveTextContent(/1 unsaved change(?!s)/)
    expect(within(region).getByRole('button', { name: 'Discard' })).toBeEnabled()
    expect(within(region).getByRole('button', { name: 'Review & save' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Save schedule' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revert unsaved changes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Pending changes' })).not.toBeInTheDocument()
    expect(screen.queryByText('You have unsaved changes.')).not.toBeInTheDocument()
  })

  it('counts one per line of the review list: two changed days make "2 unsaved changes"', async () => {
    mount()
    await editMonday()
    await pick('Tuesday closes', '20')
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent(/2 unsaved changes/)
  })

  it('is also present while another tab is open, and counts rate edits too', async () => {
    mount()
    await editMonday()
    await openTab(CLOSURES)
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent(/1 unsaved change(?!s)/)
    await addRate('800')
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent(/2 unsaved changes/)
    await openTab(CLOSURES)
    expect(barButton('Review & save')).toBeEnabled()
  })

  it('disables Review & save while a day overlaps the next, and enables it again once fixed', async () => {
    mount()
    await pick('Tuesday opens', '1')
    await pick('Monday closes', '26')
    expect(within(screen.getByRole('group', { name: 'Monday' })).getByRole('alert')).toHaveTextContent(/overlap/i)
    expect(barButton('Review & save')).toBeDisabled()
    await pick('Monday closes', '24')
    expect(barButton('Review & save')).toBeEnabled()
  })

  it('disables Review & save while saving', async () => {
    vi.mocked(saveSchedule).mockReturnValue(new Promise(() => {}))
    mount()
    await editMonday()
    await saveFromDialog()
    await waitFor(() => expect(saveSchedule).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Review & save', hidden: true })).toBeDisabled()
  })
})

describe('Discard', () => {
  it('opens the app\'s own dialog "Discard changes" with Keep editing and Discard; the safe button has focus', async () => {
    mount()
    await editMonday()
    await userEvent.click(barButton('Discard'))
    const dialog = await screen.findByRole('dialog', { name: 'Discard changes' })
    expect(within(dialog).getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: 'Discard' })).toBeInTheDocument()
  })

  it('Keep editing keeps the draft and returns focus to the Discard button', async () => {
    mount()
    await editMonday()
    await userEvent.click(barButton('Discard'))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Discard changes' })).getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('dialog', { name: 'Discard changes' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
    expect(barButton('Discard')).toHaveFocus()
    expect(saveSchedule).not.toHaveBeenCalled()
  })

  it('Escape keeps the draft and returns focus to the Discard button', async () => {
    mount()
    await editMonday()
    await userEvent.click(barButton('Discard'))
    await screen.findByRole('dialog', { name: 'Discard changes' })
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Discard changes' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
    expect(barButton('Discard')).toHaveFocus()
  })

  it('confirming restores the loaded schedule and rates, hides the bar and never saves', async () => {
    mount()
    await editMonday()
    await addRate('800')
    await openTab(HOURS)
    await userEvent.click(barButton('Discard'))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Discard changes' })).getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('dialog', { name: 'Discard changes' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('22')
    expect(bar()).not.toBeInTheDocument()
    expect(saveSchedule).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'Opening hours' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Prices' })).toBeInTheDocument()
  })
})

describe('Review changes: the plain-word list', () => {
  it('opens a dialog named Review changes with Keep editing and Save changes', async () => {
    mount()
    await editMonday()
    const dialog = await openReview()
    expect(within(dialog).getByRole('button', { name: 'Keep editing' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    expect(saveSchedule).not.toHaveBeenCalled()
  })

  it('a venue day reads "Saturday: 6 AM – 10 PM → 7 AM – 9 PM"', async () => {
    mount()
    await pick('Saturday opens', '7')
    await pick('Saturday closes', '21')
    expect(lines(await openReview())).toEqual(['Saturday: 6 AM – 10 PM → 7 AM – 9 PM'])
  })

  it('uses Midnight and (next day) for late closings', async () => {
    mount()
    await pick('Monday closes', '24')
    await pick('Friday closes', '26')
    expect(lines(await openReview())).toEqual([
      'Monday: 6 AM – 10 PM → 6 AM – Midnight',
      'Friday: 6 AM – 10 PM → 6 AM – 2 AM (next day)',
    ])
  })

  it('says Closed for a day with no periods', async () => {
    mount()
    await userEvent.click(await screen.findByRole('switch', { name: 'Tuesday open' }))
    expect(lines(await openReview())).toEqual(['Tuesday: 6 AM – 10 PM → Closed'])
  })

  it('joins several periods with ", " in start order', async () => {
    mount()
    await addBreak('Wednesday')
    await pick('Wednesday break 1 starts', '12')
    await pick('Wednesday break 1 ends', '14')
    expect(lines(await openReview())).toEqual(['Wednesday: 6 AM – 10 PM → 6 AM – 12 PM, 2 PM – 10 PM'])
  })

  it('a day that was closed and opens reads "Closed → 8 AM – 10 AM"', async () => {
    vi.mocked(fetchSchedule).mockResolvedValue(scheduleData({ venue: allDays().filter((p) => p.day_of_week !== 3) }) as never)
    vi.mocked(fetchCourts).mockResolvedValue([court('c1', 'Court One'), court('c2', 'Court Two')])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const router = createMemoryRouter([{ path: '/admin/schedule', element: <SchedulePage /> }], { initialEntries: ['/admin/schedule'] })
    render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
    await userEvent.click(await screen.findByRole('switch', { name: 'Wednesday open' }))
    await pick('Wednesday opens', '8')
    await pick('Wednesday closes', '10')
    expect(lines(await openReview())).toEqual(['Wednesday: Closed → 8 AM – 10 AM'])
  })

  it('a court going to its own hours reads "Court One: now has its own hours"', async () => {
    mount()
    await giveHours('Court One')
    expect(lines(await openReview())).toEqual(['Court One: now has its own hours'])
  })

  it('a court going back to the venue hours reads "Court Two: back to the venue\'s opening hours"', async () => {
    mount()
    await userEvent.click(await within(await screen.findByRole('region', { name: 'Courts with different hours' })).findByRole('button', { name: /^Use opening hours for Court Two/ }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Use opening hours for Court Two' })).getByRole('button', { name: 'Use opening hours' }))
    expect(lines(await openReview())).toEqual(["Court Two: back to the venue's opening hours"])
  })

  it('a custom court\'s day edit reads "Court Two, Monday: 8 AM – 8 PM → 8 AM – 12 PM"', async () => {
    mount()
    await editCourt('Court Two')
    await pick('Monday closes', '12')
    expect(lines(await openReview())).toEqual(['Court Two, Monday: 8 AM – 8 PM → 8 AM – 12 PM'])
  })

  it('a new override shows the court\'s default as "was": "Court Two, Monday 6 AM – 7 AM: ₱800 (was ₱700)"', async () => {
    mount()
    await addRate('800')
    expect(lines(await openReview())).toEqual(['Court Two, Monday 6 AM – 7 AM: ₱800 (was ₱700)'])
  })

  it('changing an existing override shows the old override as "was"', async () => {
    mount()
    await addRate('900', '18', '19')
    expect(lines(await openReview())).toEqual(['Court Two, Monday 6 PM – 7 PM: ₱900 (was ₱800)'])
  })

  it('clearing an override reads "back to the court\'s default rate (₱700)"', async () => {
    mount()
    await addRate('', '18', '19')
    expect(lines(await openReview())).toEqual(["Court Two, Monday 6 PM – 7 PM: back to the court's default rate (₱700)"])
  })

  it('lists one line per changed hour', async () => {
    mount()
    await addRate('800', '6', '8')
    expect(lines(await openReview())).toEqual([
      'Court Two, Monday 6 AM – 7 AM: ₱800 (was ₱700)',
      'Court Two, Monday 7 AM – 8 AM: ₱800 (was ₱700)',
    ])
  })

  it('orders venue days Monday to Sunday, then courts in court order, then prices; the bar count equals the lines', async () => {
    mount()
    await pick('Sunday closes', '20')
    await pick('Saturday opens', '7')
    await pick('Monday closes', '12')
    await giveHours('Court One')
    await backToAll()
    await editCourt('Court Two')
    await pick('Monday closes', '12')
    await addRate('800')
    await openTab(HOURS)
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent(/6 unsaved changes/)
    expect(lines(await openReview())).toEqual([
      'Monday: 6 AM – 10 PM → 6 AM – 12 PM',
      'Saturday: 6 AM – 10 PM → 7 AM – 10 PM',
      'Sunday: 6 AM – 10 PM → 6 AM – 8 PM',
      'Court One: now has its own hours',
      'Court Two, Monday: 8 AM – 8 PM → 8 AM – 12 PM',
      'Court Two, Monday 6 AM – 7 AM: ₱800 (was ₱700)',
    ])
  })
})

describe('Review changes: the dialog', () => {
  it('Keep editing closes it, keeps the draft and returns focus to Review & save', async () => {
    mount()
    await editMonday()
    const dialog = await openReview()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('dialog', { name: 'Review changes' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
    expect(barButton('Review & save')).toHaveFocus()
    expect(saveSchedule).not.toHaveBeenCalled()
  })

  it('Escape closes it and returns focus to Review & save', async () => {
    mount()
    await editMonday()
    await openReview()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Review changes' })).not.toBeInTheDocument()
    expect(barButton('Review & save')).toHaveFocus()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
  })

  it('moves focus inside and keeps Tab and Shift+Tab inside', async () => {
    previewMock.mockResolvedValue({
      ...noImpact(),
      bookings: { total: 1, items: [{ booking_id: 'b1', court_id: 'c2', starts_at: '2026-11-10T00:00:00Z', ends_at: '2026-11-10T01:00:00Z', status: 'confirmed' }] },
    })
    mount()
    await editMonday()
    const dialog = await openReview()
    await within(dialog).findByRole('link')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    for (let i = 0; i < 8; i++) {
      await userEvent.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    for (let i = 0; i < 8; i++) {
      await userEvent.tab({ shift: true })
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it('Save changes calls saveSchedule once with the loaded revision and the same changes payload as before', async () => {
    mount()
    await editMonday()
    await saveFromDialog()
    expect(saveSchedule).toHaveBeenCalledTimes(1)
    expect(saveSchedule).toHaveBeenCalledWith(7, {
      venue_periods: allDays().map((p) => (p.day_of_week === 1 ? { ...p, end_minute: 720 } : p)),
    })
  })

  it('sends hours, a custom court and rates together in one save', async () => {
    mount()
    await editMonday()
    await giveHours('Court One')
    await addRate('1000', '8', '9')
    await saveFromDialog()
    expect(saveSchedule).toHaveBeenCalledTimes(1)
    const [revision, changes] = vi.mocked(saveSchedule).mock.calls[0]
    expect(revision).toBe(7)
    expect(changes).toMatchObject({
      courts: [{ court_id: 'c1', schedule_mode: 'custom' }],
      rate_changes: [{ court_id: 'c2', day_of_week: 1, start_hour: 8, price: 1000 }],
    })
    expect((changes as { venue_periods: Period[] }).venue_periods).toContainEqual({ day_of_week: 1, start_minute: 360, end_minute: 720 })
  })

  it('on success the dialog closes, the draft remounts from the saved data and the bar disappears', async () => {
    mount()
    await editMonday()
    vi.mocked(fetchSchedule).mockResolvedValue(
      scheduleData({ revision: 8, venue: allDays().map((p) => (p.day_of_week === 1 ? { ...p, end_minute: 720 } : p)) }) as never)
    await saveFromDialog()
    await waitFor(() => expect(bar()).not.toBeInTheDocument())
    expect(screen.queryByRole('dialog', { name: 'Review changes' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
    expect(screen.getByRole('tab', { name: 'Opening hours' })).toBeInTheDocument()
    // the next save uses the new revision
    await pick('Monday closes', '20')
    await saveFromDialog()
    expect(vi.mocked(saveSchedule).mock.calls[1][0]).toBe(8)
  })

  it('a price-only save sends only rate_changes', async () => {
    mount()
    await addRate('800')
    await saveFromDialog()
    expect(lastChanges()).toEqual({ rate_changes: [{ court_id: 'c2', day_of_week: 1, start_hour: 6, price: 800 }] })
  })
})

describe('Review changes: existing bookings outside the new hours', () => {
  // Late night and early morning in Manila (UTC+8): 01:00 on Nov 10 is Nov 9 17:00 UTC; 07:30 on Nov 11 is Nov 10 23:30 UTC.
  const late = '2026-11-09T17:00:00Z'
  const early = '2026-11-10T23:30:00Z'
  const withItems = (): Impact => ({
    from: '2026-11-05', to: '2027-02-03',
    bookings: {
      total: 2,
      items: [
        { booking_id: 'b-late', court_id: 'c2', starts_at: late, ends_at: '2026-11-09T18:00:00Z', status: 'confirmed' },
        { booking_id: 'b-early', court_id: 'c1', starts_at: early, ends_at: '2026-11-11T00:30:00Z', status: 'confirmed' },
      ],
    },
    open_play: { total: 1, items: [{ session_id: 's1', court_id: 'c1', title: 'Friday Rally', starts_at: '2026-11-11T10:00:00Z', ends_at: '2026-11-11T12:00:00Z' }] },
  })

  it('shows the section heading, and each booking links to its booking on the venue-zone date', async () => {
    previewMock.mockResolvedValue(withItems())
    mount()
    await editMonday()
    const dialog = await openReview()
    expect(within(dialog).getByRole('heading', { name: 'Bookings outside the new hours' })).toBeInTheDocument()

    const lateLink = await within(dialog).findByRole('link', { name: `Court Two · ${formatDateTimeInZone(late, TZ)} · confirmed` })
    const lateUrl = new URL(lateLink.getAttribute('href') ?? '', 'http://x')
    expect(lateUrl.pathname).toBe('/admin/bookings')
    expect(lateUrl.searchParams.get('status')).toBe('all')
    expect([null, 'all']).toContain(lateUrl.searchParams.get('source'))
    expect(lateUrl.searchParams.get('date')).toBe('2026-11-10') // not the UTC date 2026-11-09
    expect(lateUrl.searchParams.get('booking')).toBe('b-late')

    const earlyLink = within(dialog).getByRole('link', { name: `Court One · ${formatDateTimeInZone(early, TZ)} · confirmed` })
    const earlyUrl = new URL(earlyLink.getAttribute('href') ?? '', 'http://x')
    expect(earlyUrl.searchParams.get('date')).toBe('2026-11-11') // not the UTC date 2026-11-10
    expect(earlyUrl.searchParams.get('booking')).toBe('b-early')
  })

  it('lists open play without a link, and says the reservations stay booked', async () => {
    previewMock.mockResolvedValue(withItems())
    mount()
    await editMonday()
    const dialog = await openReview()
    const item = (await within(dialog).findByText(/Friday Rally/)).closest('li')!
    expect(item).toHaveTextContent(`Friday Rally · Court One · ${formatDateTimeInZone('2026-11-11T10:00:00Z', TZ)}`)
    expect(within(item).queryByRole('link')).not.toBeInTheDocument()
    expect(within(dialog).getByText('These stay booked. Only new bookings follow the new hours.')).toBeInTheDocument()
  })

  it('previews the whole hours draft', async () => {
    mount()
    await editMonday()
    await openReview()
    await waitFor(() => expect(previewMock).toHaveBeenCalled())
    const [draft] = previewMock.mock.calls.at(-1)!
    expect(draft.venue_periods.filter((p: Period) => p.day_of_week === 1)).toEqual([{ day_of_week: 1, start_minute: 360, end_minute: 720 }])
    expect(draft.courts.map((c: { court_id: string }) => c.court_id)).toEqual(['c1', 'c2'])
  })

  it('says nothing is affected for a zero result', async () => {
    mount()
    await editMonday()
    const dialog = await openReview()
    expect(await within(dialog).findByText(/No existing reservations are affected/)).toBeInTheDocument()
  })

  it('says it is checking while the preview is pending, and Save changes still works', async () => {
    previewMock.mockReturnValue(new Promise(() => {}))
    mount()
    await editMonday()
    const dialog = await openReview()
    expect(within(dialog).getByText('Checking existing reservations…')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(saveSchedule).toHaveBeenCalledTimes(1)
  })

  it('a failed preview is quiet, retryable and does not block saving', async () => {
    previewMock.mockRejectedValueOnce(new Error('boom'))
    previewMock.mockResolvedValue(withItems())
    mount()
    await editMonday()
    const dialog = await openReview()
    expect(await within(dialog).findByText("Couldn't check existing reservations. You can still save; existing reservations are always kept.")).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeEnabled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }))
    expect(await within(dialog).findByRole('link', { name: `Court Two · ${formatDateTimeInZone(late, TZ)} · confirmed` })).toBeInTheDocument()
  })

  it('a price-only change asks for no impact and shows no impact section', async () => {
    mount()
    await addRate('800')
    const dialog = await openReview()
    expect(within(dialog).queryByRole('heading', { name: 'Bookings outside the new hours' })).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/Checking existing reservations/)).not.toBeInTheDocument()
    expect(previewMock).not.toHaveBeenCalled()
  })

  it('is not shown on the page itself, outside the dialog', async () => {
    previewMock.mockResolvedValue(withItems())
    mount()
    await editMonday()
    expect(screen.queryByRole('region', { name: 'Reservations outside the new hours' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Bookings outside the new hours' })).not.toBeInTheDocument()
  })
})

describe('conflict and save errors', () => {
  it('schedule_conflict closes the dialog, keeps the draft, offers Reload latest and disables Review & save until reload', async () => {
    vi.mocked(saveSchedule).mockRejectedValue(new ApiError('The schedule changed. Reload and try again.', 'P0001', 'schedule_conflict'))
    mount()
    await editMonday()
    await saveFromDialog()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/reload/i)
    expect(screen.queryByRole('dialog', { name: 'Review changes' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
    expect(barButton('Review & save')).toBeDisabled()
    await waitFor(() => expect(vi.mocked(fetchSchedule).mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('the conflict alert shows on whichever tab is open', async () => {
    vi.mocked(saveSchedule).mockRejectedValue(new ApiError('The schedule changed. Reload and try again.', 'P0001', 'schedule_conflict'))
    mount()
    await editMonday()
    await saveFromDialog()
    await screen.findByRole('alert')
    await openTab(PRICES)
    expect(screen.getByRole('alert')).toHaveTextContent(/reload/i)
    expect(screen.getByRole('button', { name: 'Reload latest' })).toBeVisible()
    await openTab(CLOSURES)
    expect(screen.getByRole('button', { name: 'Reload latest' })).toBeVisible()
  })

  it('Reload latest refetches and remounts the draft clean', async () => {
    vi.mocked(saveSchedule).mockRejectedValue(new ApiError('The schedule changed. Reload and try again.', 'P0001', 'schedule_conflict'))
    mount()
    await editMonday()
    await saveFromDialog()
    const reload = await screen.findByRole('button', { name: 'Reload latest' })
    vi.mocked(fetchSchedule).mockResolvedValue(
      scheduleData({ revision: 9, venue: allDays().map((p) => (p.day_of_week === 1 ? { ...p, end_minute: 1200 } : p)) }) as never)
    await userEvent.click(reload)
    await waitFor(() => expect(screen.getByLabelText('Monday closes')).toHaveValue('20'))
    expect(bar()).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reload latest' })).not.toBeInTheDocument()
  })

  it('shows other save errors in an alert with the message and a Try again that saves again', async () => {
    vi.mocked(saveSchedule).mockRejectedValueOnce(new ApiError('permission denied for table courts', 'P0001'))
    mount()
    await editMonday()
    await saveFromDialog()
    expect(await screen.findByText(/permission denied for table courts/)).toBeInTheDocument()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
    await openTab(PRICES)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(saveSchedule).toHaveBeenCalledTimes(2))
    expect(vi.mocked(saveSchedule).mock.calls[1]).toEqual(vi.mocked(saveSchedule).mock.calls[0])
    await waitFor(() => expect(bar()).not.toBeInTheDocument())
  })
})

describe('the leave-page guard', () => {
  it('warns when leaving with unsaved changes; Stay keeps the draft, Leave goes without saving', async () => {
    mount()
    await editMonday()
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
    await screen.findByRole('switch', { name: 'Monday open' })
    await userEvent.click(screen.getByRole('link', { name: 'Elsewhere' }))
    expect(await screen.findByText('Elsewhere page')).toBeInTheDocument()
  })

  it('switching tabs inside the page never triggers it', async () => {
    const router = mount()
    await editMonday()
    await openTab(PRICES)
    await openTab(CLOSURES)
    await openTab(HOURS)
    expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admin/schedule')
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
  })

  it('still fires when dirty and another tab is open', async () => {
    mount()
    await editMonday()
    await openTab(CLOSURES)
    await userEvent.click(screen.getByRole('link', { name: 'Elsewhere' }))
    expect(await screen.findByRole('dialog', { name: 'Unsaved changes' })).toBeInTheDocument()
  })
})
