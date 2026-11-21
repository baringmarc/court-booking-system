import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AdminBooking, AdminPayment, AdminRefund } from './api'
import { BookingRow } from './AdminBookingsPage'

const payment = (overrides: Partial<AdminPayment>): AdminPayment => ({
  id: 'p', method: 'paymongo', amount: 900, reference_number: null, storage_path: null, submitted_at: '2030-01-07T02:00:00.000Z',
  review_status: 'approved', review_note: null, reviewed_at: '2030-01-07T02:00:00.000Z', reviewed_by: null,
  provider_payment_id: 'pay_1', provider_source: 'gcash', ...overrides,
})
const refund = (overrides: Partial<AdminRefund> = {}): AdminRefund => ({
  id: 'r1', payment_id: 'p', amount: 900, status: 'owed', method: null, settled_on: null, reason: null, note: null,
  updated_at: '2030-01-07T03:00:00.000Z', ...overrides,
})
const booking = (payments: AdminPayment[], status: AdminBooking['status'] = 'confirmed', refunds: AdminRefund[] = []): AdminBooking => ({
  id: 'b1', reference_code: 'CB-7KQ2XD', court_id: 'c1', court_name: 'Badminton 1', sport: 'badminton', slot_start: '2030-01-07T09:00:00.000Z', slot_end: '2030-01-07T10:00:00.000Z',
  status, source: 'online', total_amount: 900, booking_fee: 0, amount_due: 900, expires_at: null, rejection_count: 0, guest_name: 'Gina Guest', guest_email: null,
  guest_phone: null, created_at: '2030-01-07T01:00:00.000Z', payments, cancelled_at: null, cancel_reason: null, cancelled_by_venue: false, parent_booking_id: null, refunds,
})

const renderRow = (b: AdminBooking) => render(<ul><li><BookingRow booking={b} timeZone="Asia/Manila" currency="PHP" /></li></ul>)

describe('BookingRow', () => {
  it('marks a booking paid online', () => {
    renderRow(booking([payment({})]))
    expect(screen.getByText('Paid online')).toBeInTheDocument()
    expect(screen.queryByText('Refund due')).not.toBeInTheDocument()
  })

  it('flags a superseded proof for follow-up, and no longer shows "Refund due" for a late online payment (T30.6)', () => {
    renderRow(booking([
      payment({ id: 'late', review_status: 'rejected', review_note: 'Payment received after the booking was cancelled.' }),
      payment({ id: 'proof', method: 'gcash', review_status: 'rejected', review_note: 'Paid online with PayMongo instead.', provider_payment_id: null, provider_source: null }),
    ], 'cancelled'))
    expect(screen.queryByText('Refund due')).not.toBeInTheDocument()
    expect(screen.getByText('Check duplicate')).toBeInTheDocument()
    expect(screen.queryByText('Paid online')).not.toBeInTheDocument()
  })

  it('badges a booking whose refund is owed (T30.6)', () => {
    renderRow(booking([payment({})], 'cancelled', [refund()]))
    expect(screen.getByText('Refund owed')).toHaveClass('badge', 'review-rejected')
  })

  it('badges it once however many refunds are owed, and when only one of several is', () => {
    renderRow(booking([payment({})], 'cancelled', [refund({ id: 'r1' }), refund({ id: 'r2' })]))
    expect(screen.getAllByText('Refund owed')).toHaveLength(1)
  })

  it('shows no refund badge for a settled or not-refunded refund', () => {
    renderRow(booking([payment({})], 'cancelled', [refund({ status: 'settled', method: 'gcash', settled_on: '2030-01-07' }), refund({ id: 'r2', status: 'not_refunded', reason: 'Played' })]))
    expect(screen.queryByText(/Refund owed|Refunded|Not refunded|Refund due/)).not.toBeInTheDocument()
  })

  it('shows no refund badge for a booking without a refund', () => {
    renderRow(booking([payment({})], 'cancelled', []))
    expect(screen.queryByText(/Refund/)).not.toBeInTheDocument()
  })

  it('shows no payment badges for a booking paid by proof', () => {
    renderRow(booking([payment({ method: 'gcash', provider_payment_id: null, provider_source: null, reviewed_by: 'admin-1' })]))
    expect(screen.queryByText(/Paid online|Refund due|Check duplicate/)).not.toBeInTheDocument()
  })
})
