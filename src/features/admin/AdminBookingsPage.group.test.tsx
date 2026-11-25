// T33.4, reworked in T33.6 (SPEC §7 `/admin/bookings`, "Bookings in a group (M33; T33.4, reworked in T33.6)"; §10 2026-11-25
// "Checkout panel"): under the default review queue (Payment under review, no search) one row stands for a checkout, titled
// with the LEAD's reference; every other view lists each booking with a "Group booking" badge. Opening any court opens one
// "Checkout CB-<lead>" panel read by group id, with a Manage button per court that opens that court's own actions (cancel
// form, Reschedule, Refund card) in place; one review decides every court, sent for the lead; the cancel form says whether
// this court only or the whole checkout is cancelled. This replaces T33.4's first-listed-court row, "Booking X of N in
// checkout", the `?q=` links and the "CB-X and its N other bookings" messages. `./api` is mocked; hooks, React Query and
// the router are real. Times are fixed in 2030.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
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
  booking_group_id: null, group_lead_id: null, ...overrides,
})

// The checkout "g1": the lead CB-LEAD01 (7 AM, the proof file is on its payment, ₱360 with the fee) and CB-PART02 (Tennis
// Court, 11 PM, ₱700), 2 courts, ₱1,060. `third` makes it 3. A single booking sits between them in time. The lead's id is 'a'.
const lead = (overrides: Partial<AdminBooking> = {}) => booking('a', 'CB-LEAD01', 'Badminton 1', '2030-01-06T23:00:00.000Z', '2030-01-07T00:00:00.000Z', 360,
  { booking_group_id: 'g1', group_lead_id: 'a', booking_fee: 10, total_amount: 350, payments: [payment('pa', 360, { storage_path: 'a/proof.png' })], ...overrides })
const part = (overrides: Partial<AdminBooking> = {}) => booking('b', 'CB-PART02', 'Tennis Court', '2030-01-07T15:00:00.000Z', '2030-01-07T17:00:00.000Z', 700,
  { booking_group_id: 'g1', group_lead_id: 'a', payments: [payment('pb', 700)], ...overrides })
const third = (overrides: Partial<AdminBooking> = {}) => booking('c', 'CB-THIRD03', 'Badminton 3', '2030-01-07T09:00:00.000Z', '2030-01-07T10:00:00.000Z', 400,
  { booking_group_id: 'g1', group_lead_id: 'a', payments: [payment('pc', 400)], ...overrides })
const solo = (overrides: Partial<AdminBooking> = {}) => booking('s', 'CB-SOLO09', 'Badminton 2', '2030-01-07T05:00:00.000Z', '2030-01-07T06:00:00.000Z', 350,
  { payments: [payment('ps', 350, { storage_path: 's/proof.png' })], ...overrides })
const confirmed = (b: AdminBooking): AdminBooking => ({ ...b, status: 'confirmed', payments: b.payments.map((p) => ({ ...p, review_status: 'approved' as const, storage_path: null })) })

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
const checkout = async () => screen.findByRole('region', { name: 'Checkout CB-LEAD01' })
const manage = (region: HTMLElement, ref: string) => within(within(region).getByRole('list', { name: 'Bookings in this checkout' })).getByRole('button', { name: `Manage ${ref}` })
/** Opens the grouped row and waits until the checkout has loaded (its panel is the proof the group was read). */
async function openGrouped(ref: RegExp) {
  await openRow(ref)
  return checkout()
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
  it('under the review queue shows one row per checkout titled with the LEAD’s reference, "N bookings" and the summed total; single bookings are unchanged', async () => {
    setBookings([lead(), part(), solo()])
    renderPage()
    const list = await rows()
    const items = await list.findAllByRole('listitem')
    expect(items).toHaveLength(2)
    // The server lists the latest play time first, so Tennis Court (CB-PART02) is listed first; the row is still the lead's.
    const row = within(list.getByRole('button', { name: /CB-LEAD01/ }))
    expect(row.getByText(/2 bookings/)).toBeInTheDocument()
    expect(row.getByText('₱1,060')).toBeInTheDocument()
    expect(row.getByText(/Gina Guest/)).toBeInTheDocument()
    expect(list.queryByRole('button', { name: /CB-PART02/ })).not.toBeInTheDocument()
    // The row sits where the group's first listed booking was (before the single booking).
    expect(within(items[0]).getByRole('button', { name: /CB-LEAD01/ })).toBeInTheDocument()
    expect(within(items[1]).getByRole('button', { name: /CB-SOLO09/ })).toBeInTheDocument()
    const single = within(list.getByRole('button', { name: /CB-SOLO09/ }))
    expect(single.getByText('₱350')).toBeInTheDocument()
    expect(single.queryByText(/courts/)).not.toBeInTheDocument()
    expect(single.queryByText('Group booking')).not.toBeInTheDocument()
  })

  it('uses the earliest-starting listed court when the lead is not in the list', async () => {
    // Only CB-PART02 and CB-THIRD03 are listed; the lead (id 'a') is not. THIRD03 starts earlier (9 AM UTC vs 3 PM UTC).
    setBookings([part(), third()], [lead(), part(), third()])
    renderPage()
    const list = await rows()
    expect(await list.findAllByRole('listitem')).toHaveLength(1)
    expect(list.getByRole('button', { name: /CB-THIRD03/ })).toHaveTextContent('2 bookings')
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
    expect(list.queryByText(/2 bookings/)).not.toBeInTheDocument()
  })
})

describe('the checkout panel', () => {
  it('opens from a queue row as "Checkout CB-<lead>", reads the group by id, and has no court open', async () => {
    setBookings([lead(), part(), solo()])
    renderPage()
    const panel = await openGrouped(/CB-LEAD01/)
    expect(within(panel).getByRole('heading', { level: 2, name: 'Checkout CB-LEAD01' })).toBeInTheDocument()
    expect(fetchAdminGroup).toHaveBeenCalledWith('g1')
    expect(screen.queryByRole('region', { name: /^Booking CB-/ })).not.toBeInTheDocument()
    expect(within(panel).getByText('Checkout total', { selector: 'dt' }).nextElementSibling).toHaveTextContent('₱1,060')
    expect(manage(panel, 'CB-LEAD01')).toHaveAttribute('aria-expanded', 'false')
    expect(manage(panel, 'CB-PART02')).toHaveAttribute('aria-expanded', 'false')
    // From the queue nothing is open, so no court's own actions are on the page.
    expect(screen.queryByRole('form', { name: 'Cancel booking' })).not.toBeInTheDocument()
  })

  it('shows ONE proof block with the group’s file, once', async () => {
    setBookings([lead(), part(), solo()])
    renderPage()
    const panel = await openGrouped(/CB-LEAD01/)
    expect(within(panel).getAllByRole('heading', { name: 'Proof waiting for review' })).toHaveLength(1)
    expect(await within(panel).findByRole('img', { name: 'Proof of payment' })).toHaveAttribute('src', 'https://signed/proof')
    expect(fetchProofUrl).toHaveBeenCalledWith('a/proof.png')
    expect(within(panel).getByText('This decides all 2 bookings at once.')).toBeInTheDocument()
  })

  it('has no link in the courts list: nothing navigates away', async () => {
    setBookings([lead(), part()])
    renderPage()
    const panel = await openGrouped(/CB-LEAD01/)
    expect(within(within(panel).getByRole('list', { name: 'Bookings in this checkout' })).queryAllByRole('link')).toHaveLength(0)
  })

})

describe('opening a court of a checkout from elsewhere', () => {
  const allConfirmed = () => setBookings([confirmed(lead()), confirmed(part()), confirmed(solo())])

  it('a click on a court’s row opens the checkout with that court’s Manage open', async () => {
    allConfirmed()
    renderPage('/admin/bookings?status=all')
    await openRow(/CB-PART02/)
    const panel = await checkout()
    expect(manage(panel, 'CB-PART02')).toHaveAttribute('aria-expanded', 'true')
    expect(manage(panel, 'CB-LEAD01')).toHaveAttribute('aria-expanded', 'false')
    expect(await within(panel).findByRole('form', { name: 'Cancel booking' })).toBeInTheDocument()
    expect(within(panel).getAllByRole('form', { name: 'Cancel booking' })).toHaveLength(1)
  })

  it('a search for a non-lead court’s reference opens the checkout with that court open', async () => {
    // A reference inside the booking-reference alphabet (no 0, 1, I, O), so parseSearch yields a `code`.
    setBookings([confirmed(lead()), confirmed(part({ reference_code: 'CB-PARTXX' })), confirmed(solo())])
    renderPage('/admin/bookings?q=CB-PARTXX')
    const panel = await checkout()
    expect(manage(panel, 'CB-PARTXX')).toHaveAttribute('aria-expanded', 'true')
    expect(manage(panel, 'CB-LEAD01')).toHaveAttribute('aria-expanded', 'false')
  })

  it('?booking=<id> opens the checkout with that court open', async () => {
    allConfirmed()
    renderPage('/admin/bookings?status=all&booking=b')
    const panel = await checkout()
    expect(manage(panel, 'CB-PART02')).toHaveAttribute('aria-expanded', 'true')
  })

  it('Manage on another court closes the open one and opens that court’s actions instead', async () => {
    allConfirmed()
    renderPage('/admin/bookings?status=all')
    await openRow(/CB-PART02/)
    const panel = await checkout()
    await userEvent.click(manage(panel, 'CB-LEAD01'))
    expect(manage(panel, 'CB-LEAD01')).toHaveAttribute('aria-expanded', 'true')
    expect(manage(panel, 'CB-PART02')).toHaveAttribute('aria-expanded', 'false')
    expect(within(panel).getAllByRole('form', { name: 'Cancel booking' })).toHaveLength(1)
    // Reschedule is that one court's too.
    expect(within(panel).getAllByRole('button', { name: 'Reschedule' })).toHaveLength(1)
  })

  it('Manage on the open court closes it', async () => {
    allConfirmed()
    renderPage('/admin/bookings?status=all')
    await openRow(/CB-PART02/)
    const panel = await checkout()
    await userEvent.click(manage(panel, 'CB-PART02'))
    expect(manage(panel, 'CB-PART02')).toHaveAttribute('aria-expanded', 'false')
    expect(within(panel).queryByRole('form', { name: 'Cancel booking' })).not.toBeInTheDocument()
  })

  it('an open court shows its own Refund card, and a cancelled court its cancelled line', async () => {
    const refund = { id: 'r1', payment_id: 'pb', amount: 700, status: 'owed' as const, method: null, settled_on: null, reason: null, note: null, updated_at: '2030-01-07T02:00:00.000Z' }
    const cancelledPart = { ...confirmed(part()), status: 'cancelled' as const, cancelled_by_venue: true, cancelled_at: '2030-01-06T19:30:00.000Z', cancel_reason: 'Court maintenance', refunds: [refund] }
    setBookings([confirmed(lead()), cancelledPart])
    renderPage('/admin/bookings?status=all')
    await openRow(/CB-PART02/)
    const panel = await checkout()
    expect(await within(panel).findByRole('region', { name: 'Refund' })).toBeInTheDocument()
    expect(within(panel).getByText(/^Cancelled by staff on .*: Court maintenance$/)).toBeInTheDocument()
    // The lead has no refund of its own: opening it hides this court's card.
    await userEvent.click(manage(panel, 'CB-LEAD01'))
    expect(within(panel).queryByRole('region', { name: 'Refund' })).not.toBeInTheDocument()
    expect(within(panel).queryByText(/Cancelled by staff/)).not.toBeInTheDocument()
  })
})

describe('the panel of a single booking', () => {
  it('stays the booking panel: no group read, no Manage, no checkout lines', async () => {
    setBookings([lead(), part(), solo()])
    renderPage()
    await openRow(/CB-SOLO09/)
    const panel = await screen.findByRole('region', { name: 'Booking CB-SOLO09' })
    expect(within(panel).queryByRole('list', { name: 'Bookings in this checkout' })).not.toBeInTheDocument()
    expect(within(panel).queryByText(/in checkout/)).not.toBeInTheDocument()
    expect(fetchAdminGroup).not.toHaveBeenCalled()
    expect(within(panel).queryByText(/This decides all/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^Checkout/ })).not.toBeInTheDocument()
  })
})

describe('loading and failing to read the checkout', () => {
  it('shows the page loader while the group loads, and neither the panel nor a cancel form', async () => {
    setBookings([confirmed(lead()), confirmed(part())])
    vi.mocked(fetchAdminGroup).mockReturnValue(new Promise(() => {}))
    renderPage('/admin/bookings?status=all')
    await openRow(/CB-PART02/)
    expect(await screen.findByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^Checkout/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Cancel booking' })).not.toBeInTheDocument()
  })

  it('shows the error with a retry, and no cancel form, when the group cannot be read; Retry reads it again', async () => {
    setBookings([confirmed(lead()), confirmed(part())])
    vi.mocked(fetchAdminGroup).mockRejectedValueOnce(new ApiError('Could not load the checkout.', 'P0001', 'load_failed'))
    renderPage('/admin/bookings?status=all')
    await openRow(/CB-PART02/)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load the checkout.')
    expect(screen.queryByRole('form', { name: 'Cancel booking' })).not.toBeInTheDocument()
    vi.mocked(fetchAdminGroup).mockResolvedValue(groupOf([confirmed(lead()), confirmed(part())]))
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await checkout()).toBeInTheDocument()
    expect(fetchAdminGroup).toHaveBeenCalledTimes(2)
  })
})

describe('reviewing a checkout', () => {
  it('approves every court with one decision sent for the LEAD, whichever court is open, and says so', async () => {
    setBookings([lead(), part()])
    renderPage('/admin/bookings?status=all')
    await openRow(/CB-PART02/)
    const panel = await checkout()
    await userEvent.click(await within(panel).findByRole('button', { name: 'Approve and confirm' }))
    await vi.waitFor(() => expect(reviewPayment).toHaveBeenCalledTimes(1))
    expect(vi.mocked(reviewPayment).mock.calls[0]).toEqual(['a', true, null])
    expect(await screen.findByText('Checkout CB-LEAD01 is confirmed (2 bookings).')).toBeInTheDocument()
  })

  it('approves from the queue too, naming the checkout’s court count (3)', async () => {
    setBookings([lead(), part(), third()])
    renderPage()
    const panel = await openGrouped(/CB-LEAD01/)
    await userEvent.click(await within(panel).findByRole('button', { name: 'Approve and confirm' }))
    expect(await screen.findByText('Checkout CB-LEAD01 is confirmed (3 bookings).')).toBeInTheDocument()
    expect(vi.mocked(reviewPayment).mock.calls[0]).toEqual(['a', true, null])
  })

  it('rejects once with the reason for the lead; a new window says so', async () => {
    vi.mocked(reviewPayment).mockResolvedValue('pending_payment')
    setBookings([lead(), part()])
    renderPage()
    const panel = await openGrouped(/CB-LEAD01/)
    await userEvent.type(await within(panel).findByLabelText('Reason for rejecting'), 'Screenshot is cut off')
    await userEvent.click(within(panel).getByRole('button', { name: 'Reject proof' }))
    await vi.waitFor(() => expect(reviewPayment).toHaveBeenCalledTimes(1))
    expect(vi.mocked(reviewPayment).mock.calls[0]).toEqual(['a', false, 'Screenshot is cut off'])
    expect(await screen.findByText('Checkout CB-LEAD01: proof rejected. The player has a new payment window to upload another proof.')).toBeInTheDocument()
  })

  it('a last rejection says its courts are cancelled and released', async () => {
    vi.mocked(reviewPayment).mockResolvedValue('rejected')
    setBookings([lead(), part()])
    renderPage()
    const panel = await openGrouped(/CB-LEAD01/)
    await userEvent.type(await within(panel).findByLabelText('Reason for rejecting'), 'Not a receipt')
    await userEvent.click(within(panel).getByRole('button', { name: 'Reject proof' }))
    expect(await screen.findByText('Checkout CB-LEAD01: proof rejected for the last time. Its bookings are cancelled and released.')).toBeInTheDocument()
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

describe('cancelling in a checkout, from a court’s Manage section', () => {
  it('a fully confirmed group cancels this court only, says the other stays booked, and says so in the message', async () => {
    setBookings([confirmed(lead()), confirmed(part())])
    renderPage('/admin/bookings?status=all')
    await openRow(/CB-PART02/)
    const form = await within(await checkout()).findByRole('form', { name: 'Cancel booking' })
    expect(await within(form).findByText('Only this booking is cancelled. The other booking in this checkout stays booked.')).toBeInTheDocument()
    await userEvent.type(within(form).getByLabelText('Reason for cancelling'), 'Court maintenance')
    await userEvent.click(within(form).getByRole('button', { name: 'Cancel booking' }))
    await vi.waitFor(() => expect(adminCancelBooking).toHaveBeenCalledTimes(1))
    expect(vi.mocked(adminCancelBooking).mock.calls[0]).toEqual(['b', 'Court maintenance'])
    expect(await screen.findByText('CB-PART02 (Tennis Court) is cancelled and the slot released. The other bookings stay booked.')).toBeInTheDocument()
  })

  it('counts the other active courts of a confirmed group: a cancelled court is not one of them', async () => {
    setBookings([confirmed(lead()), confirmed(part()), { ...confirmed(third()), status: 'cancelled' }])
    renderPage('/admin/bookings?status=all')
    await openRow(/CB-LEAD01/)
    const form = await within(await checkout()).findByRole('form', { name: 'Cancel booking' })
    expect(await within(form).findByText('Only this booking is cancelled. The other booking in this checkout stays booked.')).toBeInTheDocument()
  })

  it('says "the other 2 bookings" when two others stay booked', async () => {
    setBookings([confirmed(lead()), confirmed(part()), confirmed(third())])
    renderPage('/admin/bookings?status=all')
    await openRow(/CB-LEAD01/)
    const form = await within(await checkout()).findByRole('form', { name: 'Cancel booking' })
    expect(await within(form).findByText('Only this booking is cancelled. The other 2 bookings in this checkout stay booked.')).toBeInTheDocument()
  })

  it('a group that is not fully confirmed cancels every court, and the message says the checkout is cancelled', async () => {
    setBookings([lead(), part()])
    renderPage('/admin/bookings?status=all')
    await openRow(/CB-PART02/)
    const form = await within(await checkout()).findByRole('form', { name: 'Cancel booking' })
    expect(await within(form).findByText('This cancels all 2 bookings in this checkout, because one payment covers them all.')).toBeInTheDocument()
    await userEvent.type(within(form).getByLabelText('Reason for cancelling'), 'Court maintenance')
    await userEvent.click(within(form).getByRole('button', { name: 'Cancel booking' }))
    await vi.waitFor(() => expect(adminCancelBooking).toHaveBeenCalledTimes(1))
    // One payment covers them all, so the server cancels the whole group whichever court is named.
    expect(['a', 'b']).toContain(vi.mocked(adminCancelBooking).mock.calls[0][0])
    expect(vi.mocked(adminCancelBooking).mock.calls[0][1]).toBe('Court maintenance')
    expect(await screen.findByText('Checkout CB-LEAD01 is cancelled and its 2 bookings released.')).toBeInTheDocument()
  })

  it('counts only the active courts of a checkout that is cancelled whole', async () => {
    setBookings([lead(), part(), { ...third(), status: 'cancelled' }])
    renderPage('/admin/bookings?status=all')
    await openRow(/CB-LEAD01/)
    const form = await within(await checkout()).findByRole('form', { name: 'Cancel booking' })
    expect(await within(form).findByText('This cancels all 2 bookings in this checkout, because one payment covers them all.')).toBeInTheDocument()
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
