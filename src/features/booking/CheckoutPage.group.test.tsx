// T33.3: checkout with several runs (several courts, or several times on one court). One run still goes through
// createBooking (CheckoutPage.test.tsx and friends); two or more call createBookingGroup. The api.ts functions are
// mocked; hooks, React Query and the router are real. Times are Manila: 7 AM is 11 PM UTC the day before, and a
// 10 PM-midnight run ends on the next calendar day.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { ApiError } from '../../lib/queryClient'
import { formatDateLabel } from '../../lib/time'
import { AuthContext } from '../auth/AuthContext'
import {
  fetchCourts, fetchPublicSchedule, fetchVenueSettings, type CourtWithPhotos, type PublicSchedulePeriod, type VenueSettings,
} from '../catalog/api'
import { fetchInfoSections } from '../venue/api'
import { createBooking, createBookingGroup, fetchAvailability, fetchPlatformFee, type Slot } from './api'
import { toRunsSearch, type CheckoutRun } from './checkoutParams'
import { CheckoutPage } from './CheckoutPage'
import { TOO_MANY_RUNS_MESSAGE } from './selection'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourts: vi.fn(),
  fetchPublicSchedule: vi.fn(),
  fetchVenueSettings: vi.fn(),
}))
vi.mock('../venue/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchInfoSections: vi.fn() }))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchAvailability: vi.fn(),
  fetchPlatformFee: vi.fn(),
  createBooking: vi.fn(),
  createBookingGroup: vi.fn(),
}))

const ONE = '0c0c0c0c-0000-4000-8000-000000000001' // Court One, badminton
const TWO = '0c0c0c0c-0000-4000-8000-000000000002' // Court Two, pickleball
const mkCourt = (id: string, name: string, sport: string) => ({ id, name, sport, description: null, is_active: true, court_photos: [] }) as unknown as CourtWithPhotos
const COURTS = [mkCourt(ONE, 'Court One', 'badminton'), mkCourt(TWO, 'Court Two', 'pickleball')]
const settings = { timezone: 'Asia/Manila', currency: 'PHP', payment_hold_minutes: 30, booking_window_days: 30 } as VenueSettings
// Open 6 AM to midnight on 2030-01-07 (Manila) on both courts.
const day = (court_id: string): PublicSchedulePeriod => ({
  court_id, operating_date: '2030-01-07', period_start: '2030-01-06T22:00:00.000Z', period_end: '2030-01-07T16:00:00.000Z',
  booking_start: '2030-01-07', booking_end: '2030-02-06',
})

/** Manila hour `h` (0-24) on 2030-01-07 as an ISO instant. */
const at = (h: number) => new Date(Date.parse('2030-01-07T00:00:00+08:00') + h * 3_600_000).toISOString()
const slot = (court_id: string, h: number, price: number, extra: Partial<Slot> = {}): Slot => ({
  court_id, slot_start: at(h), slot_end: at(h + 1), price, status: 'free', booker_first_name: null, open_play_session_id: null, block_key: null, ...extra,
})

// Court One: 7 AM ₱350, then ₱400 from 8 AM to noon. Court Two: 10 PM and 11 PM at ₱500.
const availability = (): Slot[] => [
  slot(ONE, 7, 350), slot(ONE, 8, 400), slot(ONE, 9, 400), slot(ONE, 10, 400), slot(ONE, 11, 400),
  slot(TWO, 22, 500), slot(TWO, 23, 500),
]

const run = (courtId: string, h: number, slots: number): CheckoutRun => ({ courtId, start: at(h), slots })
/** Court Two 10 PM-midnight first in the URL, then Court One 7-8 AM: the page keeps the URL order. */
const TWO_COURTS = [run(TWO, 22, 2), run(ONE, 7, 1)]
const SAME_COURT = [run(ONE, 7, 1), run(ONE, 10, 2)]
const DATE_LABEL = formatDateLabel('2030-01-07', 'Asia/Manila')

function Landing() {
  const location = useLocation()
  const state = location.state as { justBooked?: boolean } | null
  return <p data-testid="landing">{`${location.pathname}${location.hash}|justBooked=${String(state?.justBooked)}`}</p>
}

function renderCheckout(search: string, who: 'anon' | 'player' = 'anon') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={authState(who)}>
        <MemoryRouter initialEntries={[`/book/checkout?${search}`]}>
          <Routes>
            <Route path="/book/checkout" element={<CheckoutPage />} />
            <Route path="/book" element={<p>Book page</p>} />
            <Route path="/booking/:reference" element={<Landing />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

/** The value shown next to a label in the booking facts (the label and its value share a row). */
async function amountFor(label: string) {
  const term = await screen.findByText(label, { exact: true })
  return term.parentElement?.textContent?.replace(label, '').trim()
}

const GROUP_RESULT = {
  groupId: 'g1',
  bookings: [{ id: 'b1', referenceCode: 'CB-LEAD01', courtId: TWO }, { id: 'b2', referenceCode: 'CB-PART02', courtId: ONE }],
  guestToken: 'tok' as string | null,
}

beforeEach(() => {
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue(settings)
  vi.mocked(fetchCourts).mockReset().mockResolvedValue(COURTS)
  vi.mocked(fetchPublicSchedule).mockReset().mockResolvedValue([day(ONE), day(TWO)])
  vi.mocked(fetchInfoSections).mockReset().mockResolvedValue([])
  vi.mocked(fetchAvailability).mockReset().mockImplementation(async () => availability())
  vi.mocked(fetchPlatformFee).mockReset().mockResolvedValue(10)
  vi.mocked(createBooking).mockReset().mockResolvedValue({ id: 'b0', referenceCode: 'CB-SINGLE', guestToken: 'tok' })
  vi.mocked(createBookingGroup).mockReset().mockResolvedValue(GROUP_RESULT)
})

async function reserve() {
  await userEvent.type(await screen.findByLabelText('Name'), 'Gina Guest')
  await userEvent.type(screen.getByLabelText('Email'), 'gina@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Reserve and continue to payment' }))
}

describe('CheckoutPage with several runs: the list and the totals', () => {
  it('lists each run in URL order under "Your courts": court, sport, date and range, and its server price', async () => {
    renderCheckout(toRunsSearch(TWO_COURTS))
    expect(await screen.findByRole('heading', { name: 'Your courts' })).toBeInTheDocument()
    const items = within(await screen.findByRole('list', { name: 'Courts and times' })).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Court Two')
    expect(items[0]).toHaveTextContent('Pickleball')
    expect(items[0]).toHaveTextContent(`${DATE_LABEL} · 10 PM–12 AM (2 hours)`)
    expect(items[0]).toHaveTextContent('₱1,000')
    expect(items[1]).toHaveTextContent('Court One')
    expect(items[1]).toHaveTextContent('Badminton')
    expect(items[1]).toHaveTextContent(`${DATE_LABEL} · 7 AM–8 AM (1 hour)`)
    expect(items[1]).toHaveTextContent('₱350')
  })

  it('two times on one court are two list items with the same court name', async () => {
    renderCheckout(toRunsSearch(SAME_COURT))
    const items = within(await screen.findByRole('list', { name: 'Courts and times' })).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Court One')
    expect(items[0]).toHaveTextContent('7 AM–8 AM (1 hour)')
    expect(items[0]).toHaveTextContent('₱350')
    expect(items[1]).toHaveTextContent('Court One')
    expect(items[1]).toHaveTextContent('10 AM–12 PM (2 hours)')
    expect(items[1]).toHaveTextContent('₱800')
  })

  it('shows the sum as Court price, ONE booking fee, and Total = sum + fee', async () => {
    renderCheckout(toRunsSearch(TWO_COURTS))
    expect(await amountFor('Court price')).toBe('₱1,350')
    expect(await amountFor('Booking fee')).toBe('₱10')
    expect(await amountFor('Total')).toBe('₱1,360')
    expect(screen.getAllByText('Booking fee', { exact: true })).toHaveLength(1)
  })

  it('adds a fee with centavos once', async () => {
    vi.mocked(fetchPlatformFee).mockResolvedValue(10.5)
    renderCheckout(toRunsSearch(SAME_COURT))
    expect(await amountFor('Court price')).toBe('₱1,150')
    expect(await amountFor('Booking fee')).toBe('₱10.50')
    expect(await amountFor('Total')).toBe('₱1,160.50')
  })

  it('has no Booking fee row when the fee is 0', async () => {
    vi.mocked(fetchPlatformFee).mockResolvedValue(0)
    renderCheckout(toRunsSearch(TWO_COURTS))
    expect(await amountFor('Total')).toBe('₱1,350')
    expect(screen.queryByText('Booking fee', { exact: true })).not.toBeInTheDocument()
  })

  it("shows a run's promo under its item, and only for runs that have one", async () => {
    vi.mocked(fetchAvailability).mockImplementation(async () => [
      slot(ONE, 7, 250, { promo_label: 'Early bird' }), ...availability().slice(1),
    ])
    renderCheckout(toRunsSearch(TWO_COURTS))
    const items = within(await screen.findByRole('list', { name: 'Courts and times' })).getAllByRole('listitem')
    expect(items[1]).toHaveTextContent('Promo: Early bird')
    expect(items[1]).toHaveTextContent('₱250')
    expect(items[0]).not.toHaveTextContent(/promo/i)
    expect(await amountFor('Court price')).toBe('₱1,250')
  })

  it('keeps the hold text, the Change time link, the details form and the waiver', async () => {
    vi.mocked(fetchVenueSettings).mockResolvedValue({ ...settings, waiver_text: 'You play at your own risk.' } as VenueSettings)
    renderCheckout(toRunsSearch(TWO_COURTS))
    expect(await screen.findByText('After you reserve, we hold these times for 30 minutes while you pay by GCash, Maya or bank transfer.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Change time' }).getAttribute('href')).toContain('date=2030-01-07')
    expect(screen.getByRole('heading', { name: 'Your details' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByText('You play at your own risk.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'I have read and accept the waiver' })).toBeInTheDocument()
  })
})

describe('CheckoutPage with several runs: reserving', () => {
  it('calls createBookingGroup (not createBooking) with the runs as items in URL order and the contact', async () => {
    renderCheckout(toRunsSearch(TWO_COURTS))
    await reserve()
    expect(createBookingGroup).toHaveBeenCalledTimes(1)
    expect(createBooking).not.toHaveBeenCalled()
    const input = vi.mocked(createBookingGroup).mock.calls[0][0]
    expect(input.items).toEqual([
      { courtId: TWO, start: at(22), slots: 2 },
      { courtId: ONE, start: at(7), slots: 1 },
    ])
    expect(input.contact).toMatchObject({ name: 'Gina Guest', email: 'gina@example.com' })
    expect(input.waiverAccepted).toBe(false)
    expect((input as Record<string, unknown>).rebookOfReference).toBeUndefined()
  })

  it('two times on one court also call createBookingGroup, with both items', async () => {
    renderCheckout(toRunsSearch(SAME_COURT))
    await reserve()
    expect(createBookingGroup).toHaveBeenCalledTimes(1)
    expect(createBooking).not.toHaveBeenCalled()
    expect(vi.mocked(createBookingGroup).mock.calls[0][0].items).toEqual([
      { courtId: ONE, start: at(7), slots: 1 },
      { courtId: ONE, start: at(10), slots: 2 },
    ])
  })

  it('sends waiverAccepted true when the waiver is ticked', async () => {
    vi.mocked(fetchVenueSettings).mockResolvedValue({ ...settings, waiver_text: 'You play at your own risk.' } as VenueSettings)
    renderCheckout(toRunsSearch(TWO_COURTS))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'I have read and accept the waiver' }))
    await reserve()
    expect(vi.mocked(createBookingGroup).mock.calls[0][0].waiverAccepted).toBe(true)
  })

  it("a guest lands on the lead's private booking link, replacing the checkout page", async () => {
    renderCheckout(toRunsSearch(TWO_COURTS))
    await reserve()
    expect((await screen.findByTestId('landing')).textContent).toBe('/booking/CB-LEAD01#token=tok|justBooked=true')
  })

  it("a signed-in player lands on the lead's booking page without a token, and sends no guest email", async () => {
    vi.mocked(createBookingGroup).mockResolvedValue({ ...GROUP_RESULT, guestToken: null })
    renderCheckout(toRunsSearch(TWO_COURTS), 'player')
    await userEvent.click(await screen.findByRole('button', { name: 'Reserve and continue to payment' }))
    expect((await screen.findByTestId('landing')).textContent).toBe('/booking/CB-LEAD01|justBooked=true')
    const input = vi.mocked(createBookingGroup).mock.calls[0][0]
    expect(input.contact).toMatchObject({ name: 'Pat Player' })
    expect(input.contact?.email).toBeUndefined()
  })

  it('one run in the old URL form still calls createBooking, never createBookingGroup', async () => {
    renderCheckout(new URLSearchParams({ court: ONE, start: at(7), slots: '1' }).toString())
    await reserve()
    expect(createBooking).toHaveBeenCalledTimes(1)
    expect(createBookingGroup).not.toHaveBeenCalled()
    expect(createBooking).toHaveBeenCalledWith(expect.objectContaining({ courtId: ONE, start: at(7), slots: 1 }))
    expect((await screen.findByTestId('landing')).textContent).toBe('/booking/CB-SINGLE#token=tok|justBooked=true')
  })

  it('a single-run page keeps its own layout (no "Your courts" list)', async () => {
    renderCheckout(new URLSearchParams({ court: ONE, start: at(7), slots: '1' }).toString())
    expect(await screen.findByRole('heading', { name: 'Court One' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your courts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Courts and times' })).not.toBeInTheDocument()
  })
})

describe('CheckoutPage with several runs: stale or failed', () => {
  it('a taken run shows only the "no longer available" sorry with a link to pick again (first run\'s sport)', async () => {
    vi.mocked(fetchAvailability).mockImplementation(async () => availability().map((s) => (s.court_id === TWO && s.slot_start === at(23) ? { ...s, status: 'booked' as const } : s)))
    renderCheckout(toRunsSearch(TWO_COURTS))
    expect(await screen.findByText('Sorry, Court Two at 10 PM is no longer available.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pick another time' })).toHaveAttribute('href', '/book?date=2030-01-07&sport=pickleball')
    expect(screen.queryByRole('button', { name: 'Reserve and continue to payment' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    expect(createBookingGroup).not.toHaveBeenCalled()
  })

  it('names every unavailable run joined with "and", and says "are"', async () => {
    vi.mocked(fetchAvailability).mockImplementation(async () => availability().map((s) => (s.slot_start === at(7) || s.slot_start === at(22) ? { ...s, status: 'booked' as const } : s)))
    renderCheckout(toRunsSearch(TWO_COURTS))
    expect(await screen.findByText('Sorry, Court Two at 10 PM and Court One at 7 AM are no longer available.')).toBeInTheDocument()
  })

  it('a run that is no longer on offer at all (the day shows no such slot) counts as unavailable', async () => {
    vi.mocked(fetchAvailability).mockImplementation(async () => availability().filter((s) => s.court_id !== ONE))
    renderCheckout(toRunsSearch(TWO_COURTS))
    expect(await screen.findByText('Sorry, Court One at 7 AM is no longer available.')).toBeInTheDocument()
  })

  it('a run on one court whose second hour is gone is unavailable', async () => {
    vi.mocked(fetchAvailability).mockImplementation(async () => availability().map((s) => (s.court_id === ONE && s.slot_start === at(11) ? { ...s, status: 'booked' as const } : s)))
    renderCheckout(toRunsSearch(SAME_COURT))
    expect(await screen.findByText('Sorry, Court One at 10 AM is no longer available.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pick another time' })).toHaveAttribute('href', '/book?date=2030-01-07&sport=badminton')
  })

  it('shows the RPC message of a taken slot in the alert with a "Pick another time" link', async () => {
    const message = 'Court Two: Sorry, that time was just booked. Please pick another slot.'
    vi.mocked(createBookingGroup).mockRejectedValue(new ApiError(message, 'P0001', 'slot_unavailable'))
    renderCheckout(toRunsSearch(TWO_COURTS))
    await reserve()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(message)
    expect(within(alert).getByRole('link', { name: 'Pick another time' })).toHaveAttribute('href', '/book?date=2030-01-07&sport=pickleball')
  })

  it('invalid_input reads "Those times can\'t be booked together", with no link to pick again', async () => {
    vi.mocked(createBookingGroup).mockRejectedValue(new ApiError('Choose the courts and times again.', 'P0001', 'invalid_input'))
    renderCheckout(toRunsSearch(TWO_COURTS))
    await reserve()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Those times can't be booked together. Please choose them again.")
    expect(within(alert).queryByRole('link', { name: 'Pick another time' })).not.toBeInTheDocument()
  })

  it('too_many_courts reads with the page wording', async () => {
    vi.mocked(createBookingGroup).mockRejectedValue(new ApiError('You can book up to 6 courts in one checkout.', 'P0001', 'too_many_courts'))
    renderCheckout(toRunsSearch(TWO_COURTS))
    await reserve()
    expect(await screen.findByRole('alert')).toHaveTextContent(TOO_MANY_RUNS_MESSAGE)
  })

  it('an unexpected error reads as the generic line', async () => {
    vi.mocked(createBookingGroup).mockRejectedValue(new TypeError('Failed to fetch'))
    renderCheckout(toRunsSearch(TWO_COURTS))
    await reserve()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Something went wrong/)
  })
})

describe('CheckoutPage with a bad URL', () => {
  it('a single run= param (a group needs 2 to 6) goes back to /book', async () => {
    renderCheckout(new URLSearchParams({ run: `${ONE},${at(7)},1` }).toString())
    expect(await screen.findByText('Book page')).toBeInTheDocument()
  })

  it('two runs overlapping on one court go back to /book', async () => {
    renderCheckout(toRunsSearch([run(ONE, 10, 2), run(ONE, 11, 1)]))
    expect(await screen.findByText('Book page')).toBeInTheDocument()
  })
})
