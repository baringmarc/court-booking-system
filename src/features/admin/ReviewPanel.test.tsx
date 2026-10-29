import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import type { AdminBooking, AdminPayment } from './api'
import { ReviewPanel, type ProofLink } from './ReviewPanel'

const pendingProof: AdminPayment = {
  id: 'p1', method: 'gcash', amount: 900, reference_number: '1234', storage_path: 'b1/proof.png',
  submitted_at: '2030-01-07T02:10:00.000Z', review_status: 'pending', review_note: null,
  reviewed_at: null, reviewed_by: null, provider_payment_id: null, provider_source: null,
}
const booking: AdminBooking = {
  id: 'b1', reference_code: 'CB-7KQ2XD', court_id: 'c1', court_name: 'Badminton 1', sport: 'badminton',
  slot_start: '2030-01-07T09:00:00.000Z', slot_end: '2030-01-07T11:00:00.000Z',
  status: 'payment_submitted', source: 'online', total_amount: 900, booking_fee: 0, amount_due: 900, expires_at: null, rejection_count: 0,
  guest_name: 'Gina Guest', guest_email: 'gina@example.com', guest_phone: '0917 222 2222',
  created_at: '2030-01-07T02:00:00.000Z', payments: [pendingProof],
  cancelled_at: null, cancel_reason: null, cancelled_by_venue: false, parent_booking_id: null,
}

function renderPanel(overrides: Partial<AdminBooking> = {}, proof: ProofLink = { state: 'ready', url: 'https://signed/proof' }, error: unknown = null) {
  const onApprove = vi.fn()
  const onReject = vi.fn()
  render(
    <ReviewPanel booking={{ ...booking, ...overrides }} timeZone="Asia/Manila" currency="PHP" proof={proof}
      pending={false} error={error} onApprove={onApprove} onReject={onReject} now={new Date('2030-01-07T03:00:00.000Z')} />,
  )
  return { onApprove, onReject }
}

describe('ReviewPanel', () => {
  it('shows the booking, the proof details and an image preview', () => {
    renderPanel()
    expect(screen.getByText('Badminton 1')).toBeInTheDocument()
    expect(screen.getByText(/GCash · ₱900 · Ref 1234/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Proof of payment' })).toHaveAttribute('src', 'https://signed/proof')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('previews PDFs with a fallback link', () => {
    renderPanel({ payments: [{ ...pendingProof, storage_path: 'b1/proof.pdf' }] })
    expect(screen.getByLabelText('Proof of payment (PDF)')).toHaveAttribute('data', 'https://signed/proof')
    expect(screen.getByRole('link', { name: 'Open PDF in a new tab' })).toBeInTheDocument()
  })

  it('warns when the amount paid differs from the total', () => {
    renderPanel({ payments: [{ ...pendingProof, amount: 850 }] })
    expect(screen.getByRole('status')).toHaveTextContent('Paid ₱850 but the total is ₱900')
  })

  it('approves', async () => {
    const { onApprove } = renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Approve and confirm' }))
    expect(onApprove).toHaveBeenCalledOnce()
  })

  it('requires a reason before rejecting, then sends it', async () => {
    const { onReject } = renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Reject proof' }))
    expect(onReject).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Reason for rejecting')).toHaveAccessibleDescription('Give a reason so the player knows what to fix.')
    await userEvent.type(screen.getByLabelText('Reason for rejecting'), '  Amount is short  ')
    await userEvent.click(screen.getByRole('button', { name: 'Reject proof' }))
    expect(onReject).toHaveBeenCalledWith('Amount is short')
  })

  it('hides the actions when nothing is waiting for review, and shows review errors', () => {
    renderPanel({ status: 'confirmed', payments: [{ ...pendingProof, review_status: 'approved' }] }, { state: 'none' },
      new ApiError('This booking has no payment waiting for review.', 'P0001', 'invalid_state'))
    expect(screen.queryByRole('button', { name: 'Approve and confirm' })).not.toBeInTheDocument()
    expect(screen.getByText('No proof is waiting for review.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('no payment waiting for review')
  })

  it('explains a missing or unloadable proof file', () => {
    renderPanel({}, { state: 'error' })
    expect(screen.getByText('The proof file could not be loaded.')).toBeInTheDocument()
  })

  it('shows who cancelled and why', () => {
    renderPanel({ status: 'cancelled', payments: [], cancelled_at: '2030-01-07T02:30:00.000Z', cancel_reason: 'Rain', cancelled_by_venue: false })
    expect(screen.getByText(/Cancelled by the customer on .*: Rain/)).toBeInTheDocument()
    expect(screen.queryByText(/Cancelled after payment/)).not.toBeInTheDocument()
  })

  it('flags a booking cancelled after payment so staff settle the refund', () => {
    renderPanel({
      status: 'cancelled', cancelled_at: '2030-01-07T02:30:00.000Z', cancel_reason: 'Court maintenance', cancelled_by_venue: true,
      payments: [{ ...pendingProof, review_status: 'approved' }],
    })
    expect(screen.getByText(/Cancelled by staff/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Cancelled after payment: settle any refund outside the app.')
  })

  describe('PayMongo payments', () => {
    const online = (overrides: Partial<AdminPayment>): AdminPayment => ({
      ...pendingProof, id: 'pm1', method: 'paymongo', storage_path: null, reference_number: null,
      review_status: 'approved', reviewed_at: '2030-01-07T02:20:00.000Z', reviewed_by: null,
      provider_payment_id: 'pay_abc123', provider_source: 'paymaya', ...overrides,
    })

    it('shows an accepted online payment with its source, PayMongo id and paid time, and no review actions', () => {
      renderPanel({ status: 'confirmed', payments: [online({})] })
      expect(screen.getByRole('heading', { name: 'Online payments' })).toBeInTheDocument()
      expect(screen.getByText(/PayMongo · Maya · ₱900/)).toBeInTheDocument()
      expect(screen.getByText(/pay_abc123 · paid Mon, Jan 7, 10:20/)).toBeInTheDocument()
      expect(screen.getByText('Accepted')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Approve and confirm' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Reject proof' })).not.toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('flags a late online payment for a refund outside the app', () => {
      renderPanel({
        status: 'cancelled', cancel_reason: 'Changed plans',
        payments: [online({ review_status: 'rejected', review_note: 'Payment received after the booking was cancelled. The venue will arrange a refund.' })],
      })
      expect(screen.getByText('Refund due')).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent(
        'Paid online (₱900) but not accepted: Payment received after the booking was cancelled. The venue will arrange a refund. Refund it outside the app.',
      )
    })

    it('flags a proof that was closed because the customer paid online', () => {
      renderPanel({
        status: 'confirmed',
        payments: [
          { ...pendingProof, review_status: 'rejected', review_note: 'Paid online with PayMongo instead.', reviewed_by: null },
          online({}),
        ],
      })
      expect(screen.getByRole('status')).toHaveTextContent(/paid online after uploading a proof.*Check it for a duplicate payment/)
    })

    it("doesn't flag a proof that staff rejected", () => {
      renderPanel({
        status: 'pending_payment',
        payments: [{ ...pendingProof, review_status: 'rejected', review_note: 'Blurry', reviewed_by: 'admin-1' }],
      })
      expect(screen.queryByText(/duplicate payment/)).not.toBeInTheDocument()
    })
  })
})
