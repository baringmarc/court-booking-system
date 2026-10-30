// T11.30: opened on a booking that waits for a new proof, the page scrolls the "Pay within" heading into view and focuses it.
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookingDetail, PaymentAttempt } from './api'
import { BookingSummary } from './BookingSummary'

const booking: BookingDetail = {
  id: 'b1', reference_code: 'CB-7KQ2XD', court_id: 'c1', court_name: 'Badminton 1', sport: 'badminton',
  slot_start: '2030-01-07T09:00:00.000Z', slot_end: '2030-01-07T11:00:00.000Z', status: 'pending_payment',
  total_amount: 900, booking_fee: 0, amount_due: 900, waiver_text: null, waiver_accepted_at: null,
  expires_at: '2030-01-07T03:00:00.000Z', rejection_count: 1, guest_name: 'Gina Guest', guest_email: 'gina@example.com',
  created_at: '2030-01-07T02:00:00.000Z', payments: [], cancelled_at: null, cancel_reason: null, cancelled_by_venue: false,
  user_id: null, parent_reference_code: null, continuations: [], changes: [],
}
const rejected = (method: PaymentAttempt['method']): PaymentAttempt => ({
  id: 'p1', method, amount: 900, reference_number: null, submitted_at: '2030-01-07T02:10:00.000Z',
  review_status: 'rejected' as const, reviewed_at: '2030-01-07T02:20:00.000Z', review_note: 'Cut off',
})

const scrollIntoView = vi.fn()
beforeEach(() => {
  scrollIntoView.mockReset()
  Element.prototype.scrollIntoView = scrollIntoView
})
afterEach(() => {
  // @ts-expect-error jsdom has no scrollIntoView; remove our stub
  delete Element.prototype.scrollIntoView
})

const show = (overrides: Partial<BookingDetail>) =>
  render(
    <BookingSummary booking={{ ...booking, ...overrides }} paymentInstructions="" timeZone="Asia/Manila" currency="PHP"
      now={new Date('2030-01-07T02:30:00.000Z')} />,
  )

describe('BookingSummary focus on a rejected proof (T11.30)', () => {
  it('focuses the Pay within heading and scrolls it into view when a proof was rejected', () => {
    show({ payments: [rejected('gcash')] })
    const heading = screen.getByRole('heading', { name: /Pay within/ })
    expect(heading).toHaveAttribute('id', 'pay-heading')
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(heading).toHaveFocus()
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('does not steal focus on a fresh booking with no rejected proof', () => {
    show({ payments: [] })
    expect(screen.getByRole('heading', { name: /Pay within/ })).not.toHaveFocus()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not focus for a rejected PayMongo payment', () => {
    show({ payments: [rejected('paymongo')] })
    expect(screen.getByRole('heading', { name: /Pay within/ })).not.toHaveFocus()
  })

  it('does not focus once the booking is no longer awaiting payment', () => {
    show({ status: 'payment_submitted', payments: [rejected('gcash')] })
    expect(screen.queryByRole('heading', { name: /Pay within/ })).not.toBeInTheDocument()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
