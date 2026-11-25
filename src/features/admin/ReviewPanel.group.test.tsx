// T33.4: the booking panel of a booking in a group (SPEC §7 `/admin/bookings`, "Bookings in a group"): where this booking
// sits in its checkout, every court with a link to the others, the checkout total, ONE proof block for the whole group
// (the pending payment that has the file, its amount the sum of the group's pending payments), and one decision for all.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { AdminBooking, AdminGroup, AdminPayment } from './api'
import { ReviewPanel, type ProofLink } from './ReviewPanel'

const payment = (id: string, overrides: Partial<AdminPayment> = {}): AdminPayment => ({
  id, method: 'gcash', amount: 360, reference_number: '1234', storage_path: null, submitted_at: '2030-01-06T19:10:00.000Z',
  review_status: 'pending', review_note: null, reviewed_at: null, reviewed_by: null, provider_payment_id: null, provider_source: null,
  ...overrides,
})
// The proof file sits on the lead's payment only (payments_path_in_booking_folder); the other court's payment has none.
const leadPayment = payment('pa', { amount: 360, storage_path: 'a/proof.png' })
const partPayment = payment('pb', { amount: 700, storage_path: null })

const lead: AdminBooking = {
  id: 'a', reference_code: 'CB-LEAD01', court_id: 'c1', court_name: 'Badminton 1', sport: 'badminton',
  slot_start: '2030-01-06T23:00:00.000Z', slot_end: '2030-01-07T00:00:00.000Z', status: 'payment_submitted', source: 'online',
  total_amount: 350, booking_fee: 10, amount_due: 360, expires_at: null, rejection_count: 0, guest_name: 'Gina Guest',
  guest_email: 'gina@example.com', guest_phone: null, created_at: '2030-01-06T15:00:00.000Z', payments: [leadPayment], refunds: [],
  cancelled_at: null, cancel_reason: null, cancelled_by_venue: false, parent_booking_id: null, booking_group_id: 'g1',
}
const part: AdminBooking = {
  ...lead, id: 'b', reference_code: 'CB-PART02', court_id: 'c2', court_name: 'Tennis Court', sport: 'tennis',
  slot_start: '2030-01-07T15:00:00.000Z', slot_end: '2030-01-07T17:00:00.000Z', total_amount: 700, booking_fee: 0, amount_due: 700, payments: [partPayment],
}
const group = (bookings: AdminBooking[] = [lead, part]): AdminGroup => ({ id: 'g1', lead_reference_code: 'CB-LEAD01', bookings })

function renderPanel(booking: AdminBooking, grp: AdminGroup | undefined, proof: ProofLink = { state: 'ready', url: 'https://signed/proof' }) {
  const onApprove = vi.fn()
  const onReject = vi.fn()
  render(
    <MemoryRouter>
      <ReviewPanel booking={booking} group={grp} timeZone="Asia/Manila" currency="PHP" proof={proof} pending={false} error={null}
        onApprove={onApprove} onReject={onReject} now={new Date('2030-01-06T20:00:00.000Z')} />
    </MemoryRouter>,
  )
  return { onApprove, onReject }
}
const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('ReviewPanel for a booking in a group', () => {
  it('says which booking of the checkout this is, by start order, and names the lead', () => {
    renderPanel(lead, group())
    expect(screen.getByText('Booking 1 of 2 in checkout CB-LEAD01')).toBeInTheDocument()
  })

  it('counts the opened booking’s place when it is not the first', () => {
    renderPanel(part, group())
    expect(screen.getByText('Booking 2 of 2 in checkout CB-LEAD01')).toBeInTheDocument()
  })

  it('lists every court: a link to the others, "This booking" on the open one, with name, time, amount and status', () => {
    renderPanel(part, group())
    const list = screen.getByRole('list', { name: 'Courts in this checkout' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)

    const other = within(items[0]).getByRole('link', { name: /CB-LEAD01/ })
    expect(other).toHaveAttribute('href', '/admin/bookings?q=CB-LEAD01')
    expect(items[0]).toHaveTextContent('Badminton 1')
    expect(items[0]).toHaveTextContent('7 AM–8 AM')
    expect(items[0]).toHaveTextContent('₱360')
    expect(items[0]).toHaveTextContent('Payment under review')
    expect(items[0]).not.toHaveTextContent('This booking')

    expect(within(items[1]).queryByRole('link')).not.toBeInTheDocument()
    expect(items[1]).toHaveTextContent('This booking')
    expect(items[1]).toHaveTextContent('CB-PART02')
    expect(items[1]).toHaveTextContent('Tennis Court')
    expect(items[1]).toHaveTextContent('11 PM–1 AM')
    expect(items[1]).toHaveTextContent('₱700')
    expect(items[1]).toHaveTextContent('Payment under review')
  })

  it('shows the status of each court by its label, so a cancelled court reads as such', () => {
    renderPanel(lead, group([lead, { ...part, status: 'cancelled' }]))
    const items = within(screen.getByRole('list', { name: 'Courts in this checkout' })).getAllByRole('listitem')
    expect(items[1]).toHaveTextContent('Cancelled')
    expect(items[0]).toHaveTextContent('Payment under review')
  })

  it('adds the "Checkout total" fact, the sum of the courts’ amounts due, after Total', () => {
    renderPanel(lead, group())
    const total = screen.getByText('Total', { selector: 'dt' })
    const checkout = screen.getByText('Checkout total', { selector: 'dt' })
    expect(checkout.nextElementSibling).toHaveTextContent('₱1,060')
    expect(follows(total, checkout)).toBe(true)
    // The booking's own Total stays its own.
    expect(total.nextElementSibling).toHaveTextContent('₱360')
  })

  it('shows ONE proof block for the group, its amount the sum of the pending payments, with the file preview', () => {
    renderPanel(lead, group())
    expect(screen.getAllByRole('heading', { name: 'Proof waiting for review' })).toHaveLength(1)
    expect(screen.getByText(/GCash · ₱1,060 · Ref 1234/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Proof of payment' })).toHaveAttribute('src', 'https://signed/proof')
    // Equal to the checkout total: no mismatch warning.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('previews the group’s file even when the open court’s own payment has none', () => {
    renderPanel(part, group())
    expect(screen.getByRole('img', { name: 'Proof of payment' })).toHaveAttribute('src', 'https://signed/proof')
    expect(screen.queryByText(/No file attached/)).not.toBeInTheDocument()
    expect(screen.getByText(/GCash · ₱1,060/)).toBeInTheDocument()
  })

  it('warns when the summed proof differs from the checkout total', () => {
    renderPanel(lead, group([{ ...lead, payments: [{ ...leadPayment, amount: 350 }] }, part]))
    expect(screen.getByRole('status')).toHaveTextContent('Paid ₱1,050 but the total is ₱1,060')
  })

  it('says "This decides all 2 courts at once." above the unchanged buttons', () => {
    renderPanel(lead, group())
    const note = screen.getByText('This decides all 2 courts at once.')
    expect(follows(note, screen.getByRole('button', { name: 'Approve and confirm' }))).toBe(true)
    expect(follows(note, screen.getByRole('button', { name: 'Reject proof' }))).toBe(true)
  })

  it('approves and rejects through the same callbacks', async () => {
    const { onApprove, onReject } = renderPanel(part, group())
    expect(screen.getByText('This decides all 2 courts at once.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Approve and confirm' }))
    expect(onApprove).toHaveBeenCalledOnce()
    await userEvent.type(screen.getByLabelText('Reason for rejecting'), 'Screenshot is cut off')
    await userEvent.click(screen.getByRole('button', { name: 'Reject proof' }))
    expect(onReject).toHaveBeenCalledWith('Screenshot is cut off')
  })

  it('can be reviewed from a court whose own payment list is empty, because the group has a pending payment', () => {
    renderPanel({ ...part, payments: [] }, group([lead, { ...part, payments: [] }]))
    expect(screen.getByRole('button', { name: 'Approve and confirm' })).toBeInTheDocument()
    expect(screen.getByText(/GCash · ₱360/)).toBeInTheDocument()
  })

  it('offers no review once the opened booking is no longer under review, or the group has nothing pending', () => {
    renderPanel({ ...lead, status: 'confirmed' }, group([{ ...lead, status: 'confirmed' }, { ...part, status: 'confirmed' }]))
    expect(screen.queryByRole('button', { name: 'Approve and confirm' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject proof' })).not.toBeInTheDocument()
  })

  it('shows no proof block and says so when nothing in the group is pending', () => {
    renderPanel({ ...lead, status: 'confirmed', payments: [] }, group([{ ...lead, status: 'confirmed', payments: [] }, { ...part, status: 'confirmed', payments: [] }]))
    expect(screen.getByText('No proof is waiting for review.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Proof waiting for review' })).not.toBeInTheDocument()
  })
})

describe('ReviewPanel without a real group', () => {
  it.each([
    ['no group', undefined],
    ['a group of one', group([lead])],
  ])('renders as today with %s', (_name, grp) => {
    renderPanel(lead, grp)
    expect(screen.queryByText(/in checkout/)).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Courts in this checkout' })).not.toBeInTheDocument()
    expect(screen.queryByText('Checkout total', { selector: 'dt' })).not.toBeInTheDocument()
    expect(screen.queryByText(/This decides all/)).not.toBeInTheDocument()
    expect(screen.getByText(/GCash · ₱360 · Ref 1234/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve and confirm' })).toBeInTheDocument()
  })
})
