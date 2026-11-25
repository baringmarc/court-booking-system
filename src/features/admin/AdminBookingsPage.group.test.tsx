// T33.4: /admin/bookings with grouped bookings (SPEC §7 `/admin/bookings`, "Bookings in a group"). Under the default review
// queue (Payment under review, no search) one row stands for a checkout; every other view lists each booking with a
// "Group booking" badge. A grouped booking's panel reads the whole group by id, a review decides every court once, and
// the cancel form says whether this court only or the whole checkout is cancelled. `./api` is mocked; hooks, React Query
// and the router are real. Times are fixed in 2030.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchVenueSettings, type VenueSettings } from '../catalog/api'
import { AdminBookingsPage } from './AdminBookingsPage'
import {
  adminCancelBooking, fetchActiveMovedParts, fetchAdminBookings, fetchAdminGroup, fetchProofUrl, reviewPayment,
  type AdminBooking, type AdminGroup, type AdminPayment,
} from './api'

vi.mock('../catalog/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchVenueSettings: vi.fn() }))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchAdminBookings: vi.fn(),
  fetchAdminGroup: vi.fn(),
  fetchActiveMovedParts: vi.fn(),
  fetchProofUrl: vi.fn(),
  reviewPayment: vi.fn(),
  adminCancelBooking: vi.fn(),
}))

const payment = (id: string, amount: number, overrides: Partial<AdminPayment> = {}): AdminPayment => ({
  id, method: 'gcash', amount, reference_number: '1234', storage_path: null, submitted_at: '2030-01-06T19:10:00.000Z',
  review_status: 'pending', review_note: null, reviewed_at: null, reviewed_by: null, provider_payment_id: null, provider_source: null,
  ...overrides,
})
const booking = (id: string, ref: string, courtName: string, start: string, end: string, amountDue: number, overrides: Partial<AdminBooking> = {}): AdminBooking => ({
  id, reference_code: ref, court_id: `c-${id}`, court_name: courtName, sport: 'badminton', slot_start: start, slot_end: end,
  status: 'payment_submitted', source: 'online', total_amount: amountDue, booking_fee: 0, amount_due: amountDue, expires_at: null,
  rejection_count: 0, guest_name: 'Gina Guest', guest_email: 'gina@example.com', guest_phone: null, created_at: '2030-01-06T15:00:00.000Z',
  payments: [], refunds: [], cancelled_at: null, cancel_reason: null, cancelled_by_venue: false, parent_booking_id: null,
  booking_group_id: null, ...overrides,
})

// The checkout "g1": the lead (7 AM, the proof file is on its payment) and Tennis Court (11 PM). A single booking sits between them.
const lead = (overrides: Partial<AdminBooking> = {}) => booking('a', 'CB-LEAD01', 'Badminton 1', '2030-01-06T23:00:00.000Z', '2030-01-07T00:00:00.000Z', 360,
  { booking_group_id: 'g1', booking_fee: 10, total_amount: 350, payments: [payment('pa', 360, { storage_path: 'a/proof.png' })], ...overrides })
const part = (overrides: Partial<AdminBooking> = {}) => booking('b', 'CB-PART02', 'Tennis Court', '2030-01-07T15:00:00.000Z', '2030-01-07T17:00:00.000Z', 700,
  { booking_group_id: 'g1', payments: [payment('pb', 700)], ...overrides })
const third = (overrides: Partial<AdminBooking> = {}) => booking('c', 'CB-THIRD03', 'Badminton 3', '2030-01-07T09:00:00.000Z', '2030-01-07T10:00:00.000Z', 400,
  { booking_group_id: 'g1', payments: [payment('pc', 400)], ...overrides })
const solo = (overrides: Partial<AdminBooking> = {}) => booking('s', 'CB-SOLO09', 'Badminton 2', '2030-01-07T05:00:00.000Z', '2030-01-07T06:00:00.000Z', 350,
  { payments: [payment('ps', 350, { storage_path: 's/proof.png' })], ...overrides })

const groupOf = (bookings: AdminBooking[]): AdminGroup => ({ id: 'g1', lead_reference_code: 'CB-LEAD01', bookings })

/** The list as the server returns it: latest play time first. */
const latestFirst = (rows: AdminBooking[]) => [...rows].sort((x, y) => y.slot_start.localeCompare(x.slot_start))

function setBookings(listed: AdminBooking[], group: AdminBooking[] = listed.filter((b) => b.booking_group_id === 'g1')) {
  vi.mocked(fetchAdminBookings).mockResolvedValue({ bookings: latestFirst(listed), truncated: false })
  vi.mocked(fetchAdminGroup).mockResolvedValue(groupOf([...group].sort((x, y) => x.slot_start.localeCompare(y.slot_start))))
}

function renderPage(path = '/admin/bookings') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><AdminBookingsPage /></MemoryRouter></QueryClientProvider>)
}
const rows = async () => within(await screen.findByRole('list', { name: 'Bookings' }))
const openRow = async (ref: RegExp) => userEvent.click(await screen.findByRole('button', { name: ref }))
/** Opens a grouped booking and waits until its group has loaded, so the decision below knows the whole checkout. */
async function openGrouped(ref: RegExp, position: string) {
  await openRow(ref)
  await screen.findByText(position)
}

beforeEach(() => {
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila', currency: 'PHP' } as VenueSettings)
  vi.mocked(fetchAdminBookings).mockReset().mockResolvedValue({ bookings: [], truncated: false })
  vi.mocked(fetchAdminGroup).mockReset()
  vi.mocked(fetchActiveMovedParts).mockReset().mockResolvedValue([])
  vi.mocked(fetchProofUrl).mockReset().mockResolvedValue('https://signed/proof')
  vi.mocked(reviewPayment).mockReset().mockResolvedValue('confirmed')
  vi.mocked(adminCancelBooking).mockReset().mockResolvedValue('cancelled')
})

describe('the list', () => {
  it('under the review queue shows one row for a checkout, with "N courts" and the summed total, and leaves single bookings alone', async () => {
    setBookings([lead(), part(), solo()])
    renderPage()
    const list = await rows()
    const items = await list.findAllByRole('listitem')
    expect(items).toHaveLength(2)
    // The checkout's row is its first booking in list order (latest play time first): Tennis Court.
    const checkout = within(list.getByRole('button', { name: /CB-PART02/ }))
    expect(checkout.getByText(/2 courts/)).toBeInTheDocument()
    expect(checkout.getByText('₱1,060')).toBeInTheDocument()
    expect(list.queryByRole('button', { name: /CB-LEAD01/ })).not.toBeInTheDocument()
    const single = within(list.getByRole('button', { name: /CB-SOLO09/ }))
    expect(single.getByText('₱350')).toBeInTheDocument()
    expect(single.queryByText(/courts/)).not.toBeInTheDocument()
    expect(single.queryByText('Group booking')).not.toBeInTheDocument()
  })

  it.each([
    ['all statuses', '/admin/bookings?status=all'],
    ['another status', '/admin/bookings?status=confirmed'],
    ['a search', '/admin/bookings?q=CB-LEAD01'],
  ])('with %s lists every booking, each grouped one badged "Group booking"', async (_name, path) => {
    setBookings([lead({ status: 'confirmed' }), part({ status: 'confirmed' }), solo({ status: 'confirmed' })])
    renderPage(path)
    const list = await rows()
    expect(await list.findAllByRole('listitem')).toHaveLength(3)
    expect(list.getAllByText('Group booking')).toHaveLength(2)
    expect(within(list.getByRole('button', { name: /CB-SOLO09/ })).queryByText('Group booking')).not.toBeInTheDocument()
    expect(list.queryByText(/2 courts/)).not.toBeInTheDocument()
  })
})

describe('the panel of a grouped booking', () => {
  it('loads the group by id and shows where it sits, the courts, the checkout total and one proof block with the group’s file', async () => {
    setBookings([lead(), part(), solo()])
    renderPage()
    await openRow(/CB-PART02/)
    const panel = await screen.findByRole('region', { name: 'Booking CB-PART02' })
    expect(await within(panel).findByText('Booking 2 of 2 in checkout CB-LEAD01')).toBeInTheDocument()
    expect(fetchAdminGroup).toHaveBeenCalledWith('g1')
    const courts = within(panel).getByRole('list', { name: 'Courts in this checkout' })
    expect(within(courts).getByRole('link', { name: /CB-LEAD01/ })).toHaveAttribute('href', '/admin/bookings?q=CB-LEAD01')
    expect(within(panel).getByText('Checkout total', { selector: 'dt' }).nextElementSibling).toHaveTextContent('₱1,060')
    expect(within(panel).getAllByRole('heading', { name: 'Proof waiting for review' })).toHaveLength(1)
    // The file is on the lead's payment, not on the opened court's.
    expect(await within(panel).findByRole('img', { name: 'Proof of payment' })).toHaveAttribute('src', 'https://signed/proof')
    expect(fetchProofUrl).toHaveBeenCalledWith('a/proof.png')
  })

  it('does not read a group for a single booking, and shows none of the group lines', async () => {
    setBookings([lead(), part(), solo()])
    renderPage()
    await openRow(/CB-SOLO09/)
    const panel = await screen.findByRole('region', { name: 'Booking CB-SOLO09' })
    expect(within(panel).queryByText(/in checkout/)).not.toBeInTheDocument()
    expect(within(panel).queryByRole('list', { name: 'Courts in this checkout' })).not.toBeInTheDocument()
    expect(fetchAdminGroup).not.toHaveBeenCalled()
    expect(within(panel).queryByText(/This decides all/)).not.toBeInTheDocument()
  })
})

describe('reviewing a checkout', () => {
  it('approves every court with one decision and names the other booking in the message', async () => {
    setBookings([lead(), part()])
    renderPage()
    await openGrouped(/CB-PART02/, 'Booking 2 of 2 in checkout CB-LEAD01')
    await userEvent.click(await screen.findByRole('button', { name: 'Approve and confirm' }))
    await vi.waitFor(() => expect(reviewPayment).toHaveBeenCalledTimes(1))
    expect(vi.mocked(reviewPayment).mock.calls[0]).toEqual(['b', true, null])
    expect(await screen.findByText('CB-PART02 and its 1 other booking is confirmed.')).toBeInTheDocument()
  })

  it('says "its 2 other bookings are confirmed" for a checkout of three', async () => {
    setBookings([lead(), part(), third()])
    renderPage()
    await openGrouped(/CB-PART02/, 'Booking 3 of 3 in checkout CB-LEAD01')
    await userEvent.click(await screen.findByRole('button', { name: 'Approve and confirm' }))
    expect(await screen.findByText('CB-PART02 and its 2 other bookings are confirmed.')).toBeInTheDocument()
  })

  it('rejects once with the reason; a new window keeps its sentence after the names', async () => {
    vi.mocked(reviewPayment).mockResolvedValue('pending_payment')
    setBookings([lead(), part()])
    renderPage()
    await openGrouped(/CB-PART02/, 'Booking 2 of 2 in checkout CB-LEAD01')
    await userEvent.type(await screen.findByLabelText('Reason for rejecting'), 'Screenshot is cut off')
    await userEvent.click(screen.getByRole('button', { name: 'Reject proof' }))
    await vi.waitFor(() => expect(reviewPayment).toHaveBeenCalledTimes(1))
    expect(vi.mocked(reviewPayment).mock.calls[0]).toEqual(['b', false, 'Screenshot is cut off'])
    const message = await screen.findByText(/^CB-PART02 and its 1 other booking/)
    expect(message).toHaveTextContent('proof rejected. The player has a new payment window to upload another proof.')
  })

  it('a last rejection keeps its existing sentence after the names', async () => {
    vi.mocked(reviewPayment).mockResolvedValue('rejected')
    setBookings([lead(), part()])
    renderPage()
    await openGrouped(/CB-PART02/, 'Booking 2 of 2 in checkout CB-LEAD01')
    await userEvent.type(await screen.findByLabelText('Reason for rejecting'), 'Not a receipt')
    await userEvent.click(screen.getByRole('button', { name: 'Reject proof' }))
    const message = await screen.findByText(/^CB-PART02 and its 1 other booking/)
    expect(message).toHaveTextContent('proof rejected for the last time. The booking is cancelled and the slot released.')
  })

  it('a single booking’s review message is unchanged', async () => {
    setBookings([lead(), part(), solo()])
    renderPage()
    await openRow(/CB-SOLO09/)
    await userEvent.click(await screen.findByRole('button', { name: 'Approve and confirm' }))
    expect(await screen.findByText('CB-SOLO09 is confirmed.')).toBeInTheDocument()
    expect(reviewPayment).toHaveBeenCalledWith('s', true, null)
  })
})

describe('cancelling in a checkout', () => {
  const confirmed = (b: AdminBooking) => ({ ...b, status: 'confirmed' as const, payments: b.payments.map((p) => ({ ...p, review_status: 'approved' as const, storage_path: null })) })

  it('a fully confirmed group cancels this court only, says the other stays booked, and keeps the one-court message', async () => {
    setBookings([confirmed(lead()), confirmed(part())])
    renderPage('/admin/bookings?status=all')
    await openRow(/CB-LEAD01/)
    const form = await screen.findByRole('form', { name: 'Cancel booking' })
    expect(await within(form).findByText('Only this court is cancelled. The other court in this checkout stays booked.')).toBeInTheDocument()
    await userEvent.type(within(form).getByLabelText('Reason for cancelling'), 'Court maintenance')
    await userEvent.click(within(form).getByRole('button', { name: 'Cancel booking' }))
    await vi.waitFor(() => expect(adminCancelBooking).toHaveBeenCalledTimes(1))
    expect(vi.mocked(adminCancelBooking).mock.calls[0]).toEqual(['a', 'Court maintenance'])
    expect(await screen.findByText('CB-LEAD01 is cancelled and the slot released.')).toBeInTheDocument()
  })

  it('counts the other active courts of a confirmed group: a cancelled court is not one of them', async () => {
    setBookings([confirmed(lead()), confirmed(part()), { ...confirmed(third()), status: 'cancelled' }])
    renderPage('/admin/bookings?status=all')
    await openRow(/CB-LEAD01/)
    expect(await screen.findByText('Only this court is cancelled. The other court in this checkout stays booked.')).toBeInTheDocument()
  })

  it('says "the other 2 courts" when two others stay booked', async () => {
    setBookings([confirmed(lead()), confirmed(part()), confirmed(third())])
    renderPage('/admin/bookings?status=all')
    await openRow(/CB-LEAD01/)
    expect(await screen.findByText('Only this court is cancelled. The other 2 courts in this checkout stay booked.')).toBeInTheDocument()
  })

  it('a group that is not fully confirmed cancels every court, and the message names the others', async () => {
    setBookings([lead(), part()])
    renderPage('/admin/bookings?status=all')
    await openRow(/CB-PART02/)
    const form = await screen.findByRole('form', { name: 'Cancel booking' })
    expect(await within(form).findByText('This cancels all 2 courts in this checkout, because one payment covers them all.')).toBeInTheDocument()
    await userEvent.type(within(form).getByLabelText('Reason for cancelling'), 'Court maintenance')
    await userEvent.click(within(form).getByRole('button', { name: 'Cancel booking' }))
    await vi.waitFor(() => expect(adminCancelBooking).toHaveBeenCalledTimes(1))
    expect(vi.mocked(adminCancelBooking).mock.calls[0]).toEqual(['b', 'Court maintenance'])
    expect(await screen.findByText(/^CB-PART02 and its 1 other booking (is|are) cancelled and the slots released\./)).toBeInTheDocument()
  })

  it('counts only the active courts of a checkout that is cancelled whole', async () => {
    setBookings([lead(), part(), { ...third(), status: 'cancelled' }])
    renderPage('/admin/bookings?status=all')
    await openRow(/CB-LEAD01/)
    expect(await screen.findByText('This cancels all 2 courts in this checkout, because one payment covers them all.')).toBeInTheDocument()
  })

  it('a single booking’s form and message are unchanged', async () => {
    setBookings([confirmed(lead()), confirmed(part()), confirmed(solo())])
    renderPage('/admin/bookings?status=all')
    await openRow(/CB-SOLO09/)
    const form = await screen.findByRole('form', { name: 'Cancel booking' })
    expect(within(form).queryByText(/in this checkout/)).not.toBeInTheDocument()
    await userEvent.type(within(form).getByLabelText('Reason for cancelling'), 'Rain')
    await userEvent.click(within(form).getByRole('button', { name: 'Cancel booking' }))
    expect(await screen.findByText('CB-SOLO09 is cancelled and the slot released.')).toBeInTheDocument()
    expect(fetchAdminGroup).not.toHaveBeenCalled()
  })
})
