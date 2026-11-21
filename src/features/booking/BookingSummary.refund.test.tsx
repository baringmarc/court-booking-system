// T30.6: the Refund card on the booking page: where it sits, for which statuses, and what happens to the old
// "Contact the venue about any refund" line.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { BookingDetail, PaymentAttempt } from './api'
import { BookingSummary } from './BookingSummary'
import { parsePlayerRefund, type PlayerRefund } from './refund'

const approved: PaymentAttempt = {
  id: 'p1', method: 'gcash', amount: 900, reference_number: null, submitted_at: '2030-01-07T02:05:00.000Z',
  review_status: 'approved', reviewed_at: '2030-01-07T02:10:00.000Z', review_note: null,
}
const booking: BookingDetail = {
  id: 'b1', reference_code: 'CB-7KQ2XD', court_id: 'c1', court_name: 'Badminton 1', sport: 'badminton',
  slot_start: '2030-01-07T09:00:00.000Z', slot_end: '2030-01-07T11:00:00.000Z', status: 'cancelled',
  total_amount: 900, booking_fee: 0, amount_due: 900, waiver_text: null, waiver_accepted_at: null, expires_at: null,
  rejection_count: 0, guest_name: 'Gina Guest', guest_email: 'gina@example.com', created_at: '2030-01-07T02:00:00.000Z',
  payments: [approved], cancelled_at: '2030-01-07T02:20:00.000Z', cancel_reason: 'Court maintenance', cancelled_by_venue: true,
  user_id: null, parent_reference_code: null, continuations: [], changes: [], refund: null,
}
const owed: PlayerRefund = { status: 'owed', amount: 900, method: null, settled_on: null, reason: null }

const renderBooking = (overrides: Partial<BookingDetail> = {}) =>
  render(
    <MemoryRouter>
      <BookingSummary booking={{ ...booking, ...overrides }} paymentInstructions="" timeZone="Asia/Manila" currency="PHP"
        now={new Date('2030-01-07T02:30:00.000Z')} venueLocation={<p>Venue address here</p>} />
    </MemoryRouter>,
  )
const refundCard = () => screen.getByRole('region', { name: 'Refund' })
const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('BookingSummary refund (T30.6)', () => {
  it('shows the owed refund on a cancelled booking, after the cancelled message and before the venue address', () => {
    renderBooking({ refund: owed })
    expect(refundCard()).toHaveTextContent('The venue owes you a refund of ₱900')
    expect(follows(screen.getByText(/The venue cancelled this booking/), refundCard())).toBe(true)
    expect(follows(refundCard(), screen.getByText('Venue address here'))).toBe(true)
  })

  it('replaces "Contact the venue about any refund" once there is a refund', () => {
    renderBooking({ refund: owed })
    expect(screen.queryByText(/Contact the venue about any refund/)).not.toBeInTheDocument()
  })

  it('keeps "Contact the venue about any refund" for a paid cancellation with no refund record', () => {
    renderBooking({ refund: null })
    expect(screen.getByText(/The times were released\. Contact the venue about any refund\./)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Refund' })).not.toBeInTheDocument()
  })

  it('does not say it for a cancellation nobody paid', () => {
    renderBooking({ payments: [], refund: null })
    expect(screen.queryByText(/refund/i)).not.toBeInTheDocument()
  })

  it('shows a settled refund', () => {
    renderBooking({ refund: { status: 'settled', amount: 900, method: 'gcash', settled_on: '2030-01-07', reason: null } })
    expect(refundCard()).toHaveTextContent('Refunded ₱900 by GCash on Mon, Jan 7')
  })

  it('shows the reason for no refund', () => {
    renderBooking({ refund: { status: 'not_refunded', amount: 900, method: null, settled_on: null, reason: 'Court was flooded' } })
    expect(refundCard()).toHaveTextContent('No refund: Court was flooded')
    expect(screen.queryByText(/Contact the venue about any refund/)).not.toBeInTheDocument()
  })

  it.each(['confirmed', 'expired', 'rejected', 'pending_payment'] as const)('shows it whatever the status, here %s', (status) => {
    renderBooking({ status, expires_at: status === 'pending_payment' ? '2030-01-07T03:00:00.000Z' : null, refund: owed })
    expect(refundCard()).toHaveTextContent('The venue owes you a refund of ₱900')
  })

  it('has no Refund card without a refund', () => {
    renderBooking({ status: 'confirmed', refund: null })
    expect(screen.queryByRole('heading', { name: 'Refund' })).not.toBeInTheDocument()
  })

  it('never shows the staff note from the data it was parsed from', () => {
    const refund = parsePlayerRefund({
      status: 'not_refunded', amount: 900, method: null, settled_on: null, reason: 'Court was flooded', note: 'STAFF ONLY: owner said ok', recorded_by: 'admin-1',
    })
    const { container } = renderBooking({ refund })
    expect(container).toHaveTextContent('No refund: Court was flooded')
    expect(container.textContent).not.toMatch(/STAFF ONLY|owner said ok|admin-1/)
  })

  it('labels a late PayMongo payment Not accepted instead of Refund due in the payment history', () => {
    renderBooking({
      payments: [{ ...approved, method: 'paymongo', review_status: 'rejected', review_note: 'Payment received after the booking was cancelled. The venue will arrange a refund.' }],
      refund: owed,
    })
    expect(screen.getByText('Not accepted', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.queryByText('Refund due')).not.toBeInTheDocument()
  })
})
