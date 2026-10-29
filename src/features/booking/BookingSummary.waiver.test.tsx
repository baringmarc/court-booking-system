// T11.20: the booking page shows the waiver text the player accepted.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { BookingDetail } from './api'
import { BookingSummary } from './BookingSummary'

const booking: BookingDetail = {
  id: 'b1', reference_code: 'CB-7KQ2XD', court_id: 'c1', court_name: 'Badminton 1', sport: 'badminton',
  slot_start: '2030-01-07T09:00:00.000Z', slot_end: '2030-01-07T11:00:00.000Z', status: 'confirmed',
  total_amount: 900, booking_fee: 0, amount_due: 900, expires_at: null, rejection_count: 0,
  guest_name: 'Gina Guest', guest_email: 'gina@example.com', created_at: '2030-01-07T02:00:00.000Z',
  payments: [], cancelled_at: null, cancel_reason: null, cancelled_by_venue: false, user_id: null,
  parent_reference_code: null, continuations: [], changes: [],
  waiver_text: null, waiver_accepted_at: null,
}

const show = (overrides: Partial<BookingDetail>) =>
  render(
    <BookingSummary booking={{ ...booking, ...overrides }} paymentInstructions="" timeZone="Asia/Manila" currency="PHP"
      now={new Date('2030-01-07T02:30:00.000Z')} />,
  )

describe('BookingSummary waiver', () => {
  it('shows "Waiver you accepted" with the text when one was accepted', () => {
    show({ waiver_text: 'You play at your own risk.', waiver_accepted_at: '2030-01-07T02:00:00.000Z' })
    expect(screen.getByRole('heading', { name: 'Waiver you accepted' })).toBeInTheDocument()
    expect(screen.getByText('You play at your own risk.')).toBeInTheDocument()
  })

  it('shows nothing when there is no waiver text', () => {
    show({})
    expect(screen.queryByText('Waiver you accepted')).not.toBeInTheDocument()
  })
})
