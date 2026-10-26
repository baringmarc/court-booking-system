import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { BookingDetail } from './api'
import { BookingSummary } from './BookingSummary'

const booking: BookingDetail = {
  id: 'b1',
  reference_code: 'CB-7KQ2XD',
  court_id: 'c1',
  court_name: 'Badminton 1',
  sport: 'badminton',
  slot_start: '2030-01-07T09:00:00.000Z', // 5 PM Manila
  slot_end: '2030-01-07T11:00:00.000Z',
  status: 'pending_payment',
  total_amount: 900,
  expires_at: '2030-01-07T03:00:00.000Z',
  rejection_count: 0,
  guest_name: 'Gina Guest',
  guest_email: 'gina@example.com',
  created_at: '2030-01-07T02:00:00.000Z',
  payments: [],
  cancelled_at: null,
  cancel_reason: null,
  cancelled_by_venue: false,
  user_id: null,
  parent_reference_code: null,
  continuations: [],
  changes: [],
}

const renderAt = (now: string, overrides: Partial<BookingDetail> = {}) =>
  render(
    <BookingSummary booking={{ ...booking, ...overrides }} paymentInstructions={'**GCash**: 0917 000 0000'}
      timeZone="Asia/Manila" currency="PHP" now={new Date(now)} />,
  )

describe('BookingSummary', () => {
  it('shows the booking in the venue timezone with a countdown and payment instructions', () => {
    renderAt('2030-01-07T02:30:00.000Z')
    expect(screen.getByText('Waiting for payment')).toBeInTheDocument()
    expect(screen.getByText('5 PM–7 PM (2 hours)')).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent('30:00')
    expect(screen.getByText('GCash')).toContainHTML('strong')
  })

  it('switches to expired once the hold runs out, without waiting for the server', () => {
    renderAt('2030-01-07T03:00:00.000Z')
    expect(screen.getByText('Expired')).toBeInTheDocument()
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(screen.getByText(/hold expired/)).toBeInTheDocument()
  })

  it('shows confirmed bookings without payment instructions', () => {
    renderAt('2030-01-07T02:30:00.000Z', { status: 'confirmed', expires_at: null })
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(screen.queryByText('GCash')).not.toBeInTheDocument()
  })

  it('renders the cancel section it is given', () => {
    render(
      <BookingSummary booking={{ ...booking, status: 'confirmed', expires_at: null }} paymentInstructions="" timeZone="Asia/Manila"
        currency="PHP" now={new Date('2030-01-07T02:30:00.000Z')} cancelSection={<p>Cancel slot</p>} />,
    )
    expect(screen.getByText('Cancel slot')).toBeInTheDocument()
  })

  it('shows the venue reason when staff cancelled', () => {
    renderAt('2030-01-07T02:30:00.000Z', { status: 'cancelled', expires_at: null, cancelled_at: '2030-01-07T02:20:00.000Z', cancel_reason: 'Court maintenance', cancelled_by_venue: true })
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
    expect(screen.getByText('The venue cancelled this booking: Court maintenance')).toBeInTheDocument()
    expect(screen.queryByText(/refund/)).not.toBeInTheDocument()
  })

  it('shows a player cancellation and points paid bookings to the venue for refunds', () => {
    renderAt('2030-01-07T02:30:00.000Z', {
      status: 'cancelled', expires_at: null, cancelled_at: '2030-01-07T02:20:00.000Z', cancel_reason: null,
      payments: [{ id: 'p1', method: 'gcash', amount: 900, reference_number: null, submitted_at: '2030-01-07T02:05:00.000Z', review_status: 'approved', reviewed_at: '2030-01-07T02:10:00.000Z', review_note: null }],
    })
    expect(screen.getByText('This booking was cancelled.')).toBeInTheDocument()
    expect(screen.getByText(/Contact the venue about any refund/)).toBeInTheDocument()
  })

  it('shows the rejection reason and the upload form after a rejected proof', () => {
    render(
      <BookingSummary
        booking={{
          ...booking,
          rejection_count: 1,
          payments: [{ id: 'p1', method: 'gcash', amount: 850, reference_number: null, submitted_at: '2030-01-07T02:10:00.000Z',
            review_status: 'rejected', reviewed_at: '2030-01-07T02:20:00.000Z', review_note: 'Amount is short by ₱50' }],
        }}
        paymentInstructions="Pay here" timeZone="Asia/Manila" currency="PHP" now={new Date('2030-01-07T02:30:00.000Z')}
        proofForm={<form aria-label="Upload proof of payment" />}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Your last proof was not accepted: Amount is short by ₱50')
    expect(screen.getByRole('form', { name: 'Upload proof of payment' })).toBeInTheDocument()
    expect(screen.getByText('Not accepted')).toBeInTheDocument()
    expect(screen.getByText('Reason: Amount is short by ₱50')).toBeInTheDocument()
  })

  it('shows an under-review message instead of the form once a proof is submitted', () => {
    render(
      <BookingSummary booking={{ ...booking, status: 'payment_submitted' }} paymentInstructions="Pay here"
        timeZone="Asia/Manila" currency="PHP" now={new Date('2030-01-07T02:30:00.000Z')}
        proofForm={<form aria-label="Upload proof of payment" />} />,
    )
    expect(screen.getByText(/We're checking your payment/)).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Upload proof of payment' })).not.toBeInTheDocument()
  })

  it('explains a final rejection', () => {
    renderAt('2030-01-07T02:30:00.000Z', {
      status: 'rejected',
      payments: [{ id: 'p1', method: 'maya', amount: 900, reference_number: null, submitted_at: '2030-01-07T02:10:00.000Z',
        review_status: 'rejected', reviewed_at: null, review_note: 'Not a receipt' }],
    })
    expect(screen.getByText(/booking was cancelled and the times were released/)).toHaveTextContent('(Not a receipt)')
  })

  it('offers paying online above the manual instructions while payable', () => {
    render(
      <BookingSummary booking={booking} paymentInstructions="**GCash**: 0917" timeZone="Asia/Manila" currency="PHP"
        now={new Date('2030-01-07T02:30:00.000Z')} payOnline={<button type="button">Pay online with PayMongo</button>}
        proofForm={<form aria-label="Upload proof of payment" />} paymentNotice={<p role="status">Online payment was cancelled.</p>} />,
    )
    expect(screen.getByRole('heading', { name: 'Pay online' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Or pay manually' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay online with PayMongo' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Online payment was cancelled.')
  })

  it('never shows a PayMongo payment as a failed proof', () => {
    renderAt('2030-01-07T02:30:00.000Z', {
      status: 'cancelled', cancel_reason: 'Changed plans',
      payments: [{ id: 'p1', method: 'paymongo', amount: 900, reference_number: null, submitted_at: '2030-01-07T02:10:00.000Z',
        review_status: 'rejected', reviewed_at: null,
        review_note: 'Payment received after the booking was cancelled. The venue will arrange a refund.' }],
    })
    expect(screen.queryByText(/proof was not accepted/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Reason:/)).not.toBeInTheDocument()
    expect(screen.getByText(/^PayMongo · ₱900/)).toBeInTheDocument()
    expect(screen.getByText('Refund due')).toBeInTheDocument()
    expect(screen.getByText('Payment received after the booking was cancelled. The venue will arrange a refund.')).toBeInTheDocument()
  })

  it('keeps the last proof rejection when a PayMongo payment is also on the booking', () => {
    renderAt('2030-01-07T02:30:00.000Z', {
      status: 'pending_payment',
      payments: [
        { id: 'p1', method: 'gcash', amount: 900, reference_number: null, submitted_at: '2030-01-07T02:05:00.000Z',
          review_status: 'rejected', reviewed_at: null, review_note: 'Blurry' },
        { id: 'p2', method: 'paymongo', amount: 899, reference_number: null, submitted_at: '2030-01-07T02:10:00.000Z',
          review_status: 'rejected', reviewed_at: null, review_note: "The amount paid online didn't match the booking total. The venue will arrange a refund." },
      ],
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Your last proof was not accepted: Blurry')
  })

  it('labels an accepted PayMongo payment as paid online', () => {
    renderAt('2030-01-07T02:30:00.000Z', {
      status: 'confirmed',
      payments: [{ id: 'p1', method: 'paymongo', amount: 900, reference_number: null, submitted_at: '2030-01-07T02:10:00.000Z',
        review_status: 'approved', reviewed_at: null, review_note: null }],
    })
    expect(screen.getByText('Paid online')).toBeInTheDocument()
  })

  it('shows what was moved, with the reason, and the moved parts', () => {
    renderAt('2030-01-07T02:30:00.000Z', {
      status: 'confirmed',
      changes: [{
        old_court_name: 'Badminton 1', old_start: '2030-01-07T09:00:00.000Z', old_end: '2030-01-07T11:00:00.000Z',
        new_court_name: 'Badminton 2', new_start: '2030-01-08T08:00:00.000Z', new_end: '2030-01-08T10:00:00.000Z',
        continuation_reference: null, reason: 'Rain', changed_at: '2030-01-07T01:00:00.000Z',
      }],
      continuations: [],
    })
    expect(screen.getByRole('heading', { name: 'Schedule changes' })).toBeInTheDocument()
    expect(screen.getByText(/Moved from Mon, Jan 7, 5 PM–7 PM \(Badminton 1\) to Tue, Jan 8, 4 PM–6 PM \(Badminton 2\)/)).toBeInTheDocument()
    expect(screen.getByText('Reason: Rain')).toBeInTheDocument()
  })

  it('has no schedule changes section for a booking that was never moved', () => {
    renderAt('2030-01-07T02:30:00.000Z')
    expect(screen.queryByRole('heading', { name: 'Schedule changes' })).not.toBeInTheDocument()
  })
})
