// T11.28: staff see the payment account label in the review panel.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AdminBooking, AdminPayment } from './api'
import { ReviewPanel } from './ReviewPanel'

const proof: AdminPayment = {
  id: 'p1', method: 'account', paid_with: 'BPI Savings', amount: 900, reference_number: '1234', storage_path: 'b1/proof.png',
  submitted_at: '2030-01-07T02:10:00.000Z', review_status: 'pending', review_note: null,
  reviewed_at: null, reviewed_by: null, provider_payment_id: null, provider_source: null,
}
const booking: AdminBooking = {
  id: 'b1', reference_code: 'CB-7KQ2XD', court_id: 'c1', court_name: 'Badminton 1', sport: 'badminton',
  slot_start: '2030-01-07T09:00:00.000Z', slot_end: '2030-01-07T11:00:00.000Z',
  status: 'payment_submitted', source: 'online', total_amount: 900, booking_fee: 0, amount_due: 900, expires_at: null, rejection_count: 0,
  guest_name: 'Gina Guest', guest_email: 'gina@example.com', guest_phone: '09172222222',
  created_at: '2030-01-07T02:00:00.000Z', payments: [proof],
  cancelled_at: null, cancel_reason: null, cancelled_by_venue: false, parent_booking_id: null,
}
const renderPanel = (payment: AdminPayment) =>
  render(
    <ReviewPanel booking={{ ...booking, payments: [payment] }} timeZone="Asia/Manila" currency="PHP"
      proof={{ state: 'ready', url: 'https://signed/proof' }} pending={false} error={null}
      onApprove={vi.fn()} onReject={vi.fn()} now={new Date('2030-01-07T03:00:00.000Z')} />,
  )

describe('ReviewPanel paid with', () => {
  it('shows the account label on the proof waiting for review', () => {
    renderPanel(proof)
    expect(screen.getByText(/BPI Savings · ₱900 · Ref 1234/)).toBeInTheDocument()
    expect(screen.queryByText(/Payment account/)).not.toBeInTheDocument()
  })

  it('shows the method label when paid_with is null', () => {
    renderPanel({ ...proof, method: 'gcash', paid_with: null })
    expect(screen.getByText(/GCash · ₱900 · Ref 1234/)).toBeInTheDocument()
  })
})
