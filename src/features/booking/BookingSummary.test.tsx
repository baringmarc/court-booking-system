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
    expect(screen.queryByText(/Cancelling online/)).not.toBeInTheDocument()
  })

  it('shows confirmed bookings without payment instructions', () => {
    renderAt('2030-01-07T02:30:00.000Z', { status: 'confirmed', expires_at: null })
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(screen.queryByText('GCash')).not.toBeInTheDocument()
    expect(screen.getByText(/Cancelling online/)).toBeInTheDocument()
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
})
