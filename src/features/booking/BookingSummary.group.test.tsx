// T33.4: the booking page for a booking in a group (SPEC §7 `/booking/:ref`, "A booking in a group"): the whole checkout
// in one card, the group's status and total, one payment path, the partial staff-cancel alert and one refund card per
// court. Times are fixed and in Asia/Manila: Badminton 1 is 7 AM (the previous UTC day), Tennis Court 11 PM to 1 AM.
import { render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { BookingDetail, BookingGroup, BookingGroupCourt, PaymentAttempt } from './api'
import { BookingSummary } from './BookingSummary'
import { parseCheckoutSearch } from './checkoutParams'
import type { PlayerRefund } from './refund'

const C1 = '0b8e7c1a-3d2f-4a5b-9c6d-7e8f90a1b2c3'
const C2 = '1c9f8d2b-4e3a-4b6c-8d7e-8f9a01b2c3d4'

const lead: BookingGroupCourt = {
  reference_code: 'CB-LEAD01', court_id: C1, court_name: 'Badminton 1', sport: 'badminton',
  slot_start: '2030-01-06T23:00:00.000Z', slot_end: '2030-01-07T00:00:00.000Z', status: 'pending_payment',
  total_amount: 350, booking_fee: 10, amount_due: 360, refund: null,
}
const part: BookingGroupCourt = {
  reference_code: 'CB-PART02', court_id: C2, court_name: 'Tennis Court', sport: 'tennis',
  slot_start: '2030-01-07T15:00:00.000Z', slot_end: '2030-01-07T17:00:00.000Z', status: 'pending_payment',
  total_amount: 700, booking_fee: 0, amount_due: 700, refund: null,
}
const group = (bookings: BookingGroupCourt[] = [lead, part], overrides: Partial<BookingGroup> = {}): BookingGroup => ({
  id: 'g1', lead_reference_code: 'CB-LEAD01', total_amount: 1050, booking_fee: 10, amount_due: 1060, bookings, ...overrides,
})

// The booking the page opened, as the lead; tests override fields to open the other court.
const base: BookingDetail = {
  id: 'b1', reference_code: 'CB-LEAD01', court_id: C1, court_name: 'Badminton 1', sport: 'badminton',
  slot_start: lead.slot_start, slot_end: lead.slot_end, status: 'pending_payment',
  total_amount: 350, booking_fee: 10, amount_due: 360, waiver_text: null, waiver_accepted_at: null,
  expires_at: '2030-01-06T20:30:00.000Z', rejection_count: 0, guest_name: 'Gina Guest', guest_email: 'gina@example.com',
  created_at: '2030-01-06T15:00:00.000Z', payments: [], cancelled_at: null, cancel_reason: null, cancelled_by_venue: false,
  user_id: null, parent_reference_code: null, continuations: [], changes: [], refund: null, group: group(),
}
const opened2: Partial<BookingDetail> = {
  id: 'b2', reference_code: 'CB-PART02', court_id: C2, court_name: 'Tennis Court', sport: 'tennis',
  slot_start: part.slot_start, slot_end: part.slot_end, total_amount: 700, booking_fee: 0, amount_due: 700,
}

const NOW = '2030-01-06T20:00:00.000Z' // 4 AM Mon, Jan 7 in Manila; the hold has 30 minutes left

type Slots = Partial<Pick<ComponentProps<typeof BookingSummary>, 'payOnline' | 'paymentAccounts' | 'proofForm' | 'venueLocation'>>
const renderBooking = (overrides: Partial<BookingDetail> = {}, now = NOW, slots: Slots = {}) =>
  render(
    <MemoryRouter>
      <BookingSummary booking={{ ...base, ...overrides }} paymentInstructions="**GCash**: 0917 000 0000" timeZone="Asia/Manila"
        currency="PHP" now={new Date(now)} {...slots} />
    </MemoryRouter>,
  )

const fact = (label: string) => {
  const dd = screen.getByText(label, { selector: 'dt' }).nextElementSibling
  return dd?.textContent ?? null
}
const courtList = () => screen.getByRole('list', { name: 'Courts in this booking' })
const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('BookingSummary: the details card of a group', () => {
  it('is headed "Your courts" with one badge, not the opened court’s name', () => {
    renderBooking()
    expect(screen.getByRole('heading', { level: 2, name: 'Your courts' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: 'Badminton 1' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: 'Tennis Court' })).not.toBeInTheDocument()
    // The group's status, shown once: no court differs from it, so the list has no badges.
    expect(screen.getAllByText('Waiting for payment')).toHaveLength(1)
  })

  it('lists every court with its name, sport, date, time range and hours, reference and court price', () => {
    renderBooking()
    const items = within(courtList()).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Badminton 1')
    expect(items[0]).toHaveTextContent('Badminton')
    expect(items[0]).toHaveTextContent('Mon, Jan 7')
    expect(items[0]).toHaveTextContent('7 AM–8 AM')
    expect(items[0]).toHaveTextContent('1 hour')
    expect(items[0]).toHaveTextContent('CB-LEAD01')
    expect(items[0]).toHaveTextContent('₱350')
    expect(items[0]).not.toHaveTextContent('₱360')
    expect(items[1]).toHaveTextContent('Tennis Court')
    expect(items[1]).toHaveTextContent('Tennis')
    expect(items[1]).toHaveTextContent('Mon, Jan 7')
    expect(items[1]).toHaveTextContent('11 PM–1 AM')
    expect(items[1]).toHaveTextContent('2 hours')
    expect(items[1]).toHaveTextContent('CB-PART02')
    expect(items[1]).toHaveTextContent('₱700')
  })

  it('shows the lead’s reference and the group’s sums as facts, whichever court was opened', () => {
    renderBooking(opened2)
    expect(fact('Reference')).toBe('CB-LEAD01')
    expect(fact('Court price')).toBe('₱1,050')
    expect(fact('Booking fee')).toBe('₱10')
    expect(fact('Total')).toBe('₱1,060')
    expect(fact('Name')).toBe('Gina Guest')
  })

  it('shows no Booking fee fact when the group’s fee is 0', () => {
    renderBooking({ group: group([{ ...lead, booking_fee: 0, amount_due: 350 }, part], { booking_fee: 0, amount_due: 1050 }) })
    expect(screen.queryByText('Booking fee', { selector: 'dt' })).not.toBeInTheDocument()
    expect(fact('Total')).toBe('₱1,050')
  })

  it('puts a status badge on a court only when its displayed status differs from the group’s', () => {
    // Badminton 1 has been played (it ended 2030-01-07T00:00Z); Tennis Court is still ahead: the group is Confirmed.
    renderBooking({ status: 'confirmed', expires_at: null, group: group([{ ...lead, status: 'confirmed' }, { ...part, status: 'confirmed' }]) }, '2030-01-07T10:00:00.000Z')
    const items = within(courtList()).getAllByRole('listitem')
    expect(within(items[0]).getByText('Completed')).toBeInTheDocument()
    expect(within(items[1]).queryByText(/Confirmed|Completed|Cancelled|Waiting|Payment under review/)).not.toBeInTheDocument()
    expect(screen.getByText('Confirmed', { selector: '.badge' })).toBeInTheDocument()
  })

  it('badges a cancelled court while the group stays confirmed', () => {
    renderBooking({ status: 'confirmed', expires_at: null, group: group([{ ...lead, status: 'confirmed' }, { ...part, status: 'cancelled' }]) })
    const items = within(courtList()).getAllByRole('listitem')
    expect(within(items[0]).queryByText('Cancelled')).not.toBeInTheDocument()
    expect(within(items[1]).getByText('Cancelled')).toBeInTheDocument()
    expect(screen.getAllByText('Confirmed', { selector: '.badge' })).toHaveLength(1)
  })
})

describe('BookingSummary: one payment path for the group', () => {
  const slots = {
    payOnline: <button type="button">Pay online with PayMongo</button>,
    paymentAccounts: <ul aria-label="Payment accounts"><li>GCash</li></ul>,
    proofForm: <form aria-label="Upload proof of payment" />,
  }

  it('shows the countdown of the booking, and the group’s total with the lead’s reference as the payment note', () => {
    renderBooking({}, NOW, slots)
    const pay = screen.getByRole('region', { name: /Pay within/ })
    expect(within(pay).getByRole('timer')).toHaveTextContent('30:00')
    expect(pay).toHaveTextContent(/Pay ₱1,060 .* with CB-LEAD01 as the payment note/)
    expect(pay).not.toHaveTextContent('₱360')
  })

  it('names the lead as the payment note even when another court’s page is open', () => {
    renderBooking(opened2, NOW, slots)
    expect(screen.getByRole('region', { name: /Pay within/ })).toHaveTextContent(/Pay ₱1,060 .* with CB-LEAD01 as the payment note/)
  })

  it('renders the pay online button, the payment accounts and the proof form once each', () => {
    renderBooking({}, NOW, slots)
    expect(screen.getAllByRole('button', { name: 'Pay online with PayMongo' })).toHaveLength(1)
    expect(screen.getAllByRole('list', { name: 'Payment accounts' })).toHaveLength(1)
    expect(screen.getAllByRole('form', { name: 'Upload proof of payment' })).toHaveLength(1)
  })

  it('marks the group’s step in the progress line, from the group’s status', () => {
    // The opened court was cancelled by staff, but the group is confirmed: the line is on "Confirmed".
    renderBooking({ ...opened2, status: 'cancelled', expires_at: null, cancelled_by_venue: true, group: group([{ ...lead, status: 'confirmed' }, { ...part, status: 'cancelled' }]) })
    const current = screen.getByRole('list', { name: 'Booking progress' }).querySelector('[aria-current="step"]')
    expect(current).toHaveTextContent('Confirmed')
  })
})

describe('BookingSummary: status alerts follow the group’s status', () => {
  const paid: PaymentAttempt = {
    id: 'p1', method: 'gcash', amount: 1060, reference_number: null, submitted_at: '2030-01-06T19:30:00.000Z',
    review_status: 'pending', reviewed_at: null, review_note: null,
  }

  it('under review: "Proof received" and the hand-check line, no pay card', () => {
    renderBooking({ status: 'payment_submitted', payments: [paid], group: group([{ ...lead, status: 'payment_submitted' }, { ...part, status: 'payment_submitted' }]) },
      NOW, { proofForm: <form aria-label="Upload proof of payment" /> })
    expect(screen.getByRole('heading', { level: 2, name: 'Your courts' })).toBeInTheDocument()
    expect(screen.getByText(/Proof received/)).toBeInTheDocument()
    expect(screen.getByText(/The venue checks payments by hand/)).toBeInTheDocument()
    expect(screen.getByText('Payment under review', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Upload proof of payment' })).not.toBeInTheDocument()
  })

  it('expired (derived from the hold running out): the alert links "Book a court", never "Try this time again"', () => {
    renderBooking({}, '2030-01-06T20:31:00.000Z')
    expect(screen.getByText('Expired', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.getByText(/hold expired before payment was received/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Book a court' })).toHaveAttribute('href', '/book')
    expect(screen.queryByRole('link', { name: 'Try this time again' })).not.toBeInTheDocument()
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
  })

  it('rejected: keeps its text and links "Book a court" even while the start is ahead', () => {
    renderBooking({
      status: 'rejected', expires_at: null,
      payments: [{ ...paid, review_status: 'rejected', review_note: 'Not a receipt' }],
      group: group([{ ...lead, status: 'rejected' }, { ...part, status: 'rejected' }]),
    })
    expect(screen.getByText(/booking was cancelled and the times were released/)).toHaveTextContent('(Not a receipt)')
    expect(screen.getByRole('link', { name: 'Book a court' })).toHaveAttribute('href', '/book')
    expect(screen.queryByRole('link', { name: 'Try this time again' })).not.toBeInTheDocument()
  })

  describe('cancelled', () => {
    const approved: PaymentAttempt = { ...paid, review_status: 'approved', reviewed_at: '2030-01-06T19:40:00.000Z' }
    const cancelledGroup = (refund: PlayerRefund | null) =>
      group([{ ...lead, status: 'cancelled', refund: null }, { ...part, status: 'cancelled', refund }])
    const cancelled: Partial<BookingDetail> = { status: 'cancelled', expires_at: null, cancelled_at: '2030-01-06T19:50:00.000Z', cancel_reason: 'Court maintenance', cancelled_by_venue: true, payments: [approved] }

    it('says to contact the venue about a refund only when none of the courts has a refund record', () => {
      renderBooking({ ...cancelled, group: cancelledGroup(null) })
      expect(screen.getByRole('heading', { level: 2, name: 'Your courts' })).toBeInTheDocument()
      expect(screen.getByText('Cancelled', { selector: '.badge' })).toBeInTheDocument()
      expect(screen.getByText(/The venue cancelled this booking: Court maintenance/)).toBeInTheDocument()
      expect(screen.getByText(/Contact the venue about any refund\./)).toBeInTheDocument()
    })

    it('drops that line once any court has a refund record, even when the opened court has none', () => {
      renderBooking({ ...cancelled, refund: null, group: cancelledGroup({ status: 'owed', amount: 700, method: null, settled_on: null, reason: null }) })
      expect(screen.queryByText(/Contact the venue about any refund/)).not.toBeInTheDocument()
    })
  })
})

describe('BookingSummary: staff cancelled some courts and the others stay booked', () => {
  const confirmedOneCancelled = group([{ ...lead, status: 'confirmed' }, { ...part, status: 'cancelled' }])

  it('tells the player which courts were cancelled and that the others are still booked', () => {
    renderBooking({ status: 'confirmed', expires_at: null, group: confirmedOneCancelled })
    expect(screen.getByRole('status')).toHaveTextContent('The venue cancelled Tennis Court. The other courts are still booked.')
  })

  it('adds the reason after the names when the opened court is the cancelled one', () => {
    renderBooking({ ...opened2, status: 'cancelled', expires_at: null, cancelled_by_venue: true, cancel_reason: 'Court maintenance', group: confirmedOneCancelled })
    expect(screen.getByRole('status')).toHaveTextContent('The venue cancelled Tennis Court: Court maintenance. The other courts are still booked.')
    // It is not the single-booking alert.
    expect(screen.queryByText(/The venue cancelled this booking/)).not.toBeInTheDocument()
  })

  it('names every cancelled court', () => {
    const third: BookingGroupCourt = { ...part, reference_code: 'CB-THIRD03', court_name: 'Badminton 2', court_id: null, slot_start: '2030-01-07T05:00:00.000Z', slot_end: '2030-01-07T06:00:00.000Z' }
    renderBooking({ status: 'confirmed', expires_at: null, group: group([{ ...lead, status: 'confirmed' }, { ...third, status: 'cancelled' }, { ...part, status: 'cancelled' }]) })
    const alert = screen.getByRole('status')
    expect(alert.textContent).toMatch(/Badminton 2/)
    expect(alert.textContent).toMatch(/Tennis Court/)
    expect(alert).toHaveTextContent('The other courts are still booked.')
  })

  it('shows no such alert while every court stands', () => {
    renderBooking({ status: 'confirmed', expires_at: null, group: group([{ ...lead, status: 'confirmed' }, { ...part, status: 'confirmed' }]) })
    expect(screen.queryByText(/The other courts are still booked/)).not.toBeInTheDocument()
  })
})

describe('BookingSummary: one refund card per court with a refund', () => {
  const owed: PlayerRefund = { status: 'owed', amount: 700, method: null, settled_on: null, reason: null }
  const settled: PlayerRefund = { status: 'settled', amount: 350, method: 'gcash', settled_on: '2030-01-07', reason: null }

  it('titles each card with the court’s name and shows that court’s refund', () => {
    renderBooking({ status: 'cancelled', expires_at: null, cancelled_by_venue: true, group: group([{ ...lead, status: 'cancelled', refund: settled }, { ...part, status: 'cancelled', refund: owed }]) })
    expect(screen.getByRole('region', { name: 'Refund: Badminton 1' })).toHaveTextContent('Refunded ₱350 by GCash on Mon, Jan 7')
    expect(screen.getByRole('region', { name: 'Refund: Tennis Court' })).toHaveTextContent('The venue owes you a refund of ₱700')
  })

  it('shows a card only for a court that has a refund, and not the booking’s own refund again', () => {
    renderBooking({
      ...opened2, status: 'cancelled', expires_at: null, cancelled_by_venue: true, refund: owed,
      group: group([{ ...lead, status: 'confirmed' }, { ...part, status: 'cancelled', refund: owed }]),
    })
    expect(screen.getAllByRole('region', { name: /^Refund/ })).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Refund: Tennis Court' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Refund' })).not.toBeInTheDocument()
  })

  it('shows none when no court has a refund', () => {
    renderBooking({ status: 'confirmed', expires_at: null, group: group([{ ...lead, status: 'confirmed' }, { ...part, status: 'confirmed' }]) })
    expect(screen.queryByRole('region', { name: /^Refund/ })).not.toBeInTheDocument()
  })

  it('puts the cards after the status alerts and before the venue location', () => {
    renderBooking({ status: 'confirmed', expires_at: null, group: group([{ ...lead, status: 'confirmed' }, { ...part, status: 'cancelled', refund: owed }]) }, NOW,
      { venueLocation: <p>Venue address here</p> })
    const card = screen.getByRole('region', { name: 'Refund: Tennis Court' })
    expect(follows(screen.getByRole('status'), card)).toBe(true)
    expect(follows(card, screen.getByText('Venue address here'))).toBe(true)
  })
})

describe('BookingSummary: Same time next week stays per court', () => {
  const sameTime = () => screen.queryAllByRole('link', { name: /^Same time next week/ })

  it('is one link for the opened court, named with its court name, with that court’s id, hours and reference', () => {
    renderBooking({ ...opened2, status: 'confirmed', expires_at: null, group: group([{ ...lead, status: 'confirmed' }, { ...part, status: 'confirmed' }]) })
    expect(sameTime()).toHaveLength(1)
    const link = sameTime()[0]
    expect(link).toHaveAccessibleName(/^Same time next week.*Tennis Court$/)
    const url = new URL(link.getAttribute('href')!, 'http://localhost')
    expect(url.pathname).toBe('/book/checkout')
    expect(parseCheckoutSearch(url.searchParams)).toMatchObject({ courtId: C2, slots: 2 })
    expect(url.searchParams.get('rebook')).toBe('CB-PART02')
  })

  it('is offered for a played court too (completed)', () => {
    renderBooking({ status: 'confirmed', expires_at: null, group: group([{ ...lead, status: 'confirmed' }, { ...part, status: 'confirmed' }]) }, '2030-01-07T10:00:00.000Z')
    expect(sameTime()).toHaveLength(1)
    expect(sameTime()[0]).toHaveAccessibleName(/Badminton 1$/)
  })

  it('is not offered on a court that is cancelled, even though the group is confirmed', () => {
    renderBooking({ ...opened2, status: 'cancelled', expires_at: null, cancelled_by_venue: true, group: group([{ ...lead, status: 'confirmed' }, { ...part, status: 'cancelled' }]) })
    expect(sameTime()).toHaveLength(0)
  })

  it('is not offered while the opened court is unpaid or under review', () => {
    renderBooking({ status: 'pending_payment' })
    expect(sameTime()).toHaveLength(0)
  })
})

describe('BookingSummary: a booking without a group reads as before', () => {
  it.each([undefined, null])('with group = %s: the court name heading, no courts list, its own totals', (value) => {
    renderBooking({ group: value })
    expect(screen.getByRole('heading', { level: 2, name: 'Badminton 1' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your courts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Courts in this booking' })).not.toBeInTheDocument()
    expect(fact('Total')).toBe('₱360')
    expect(screen.queryByText(/The other courts are still booked/)).not.toBeInTheDocument()
  })
})
