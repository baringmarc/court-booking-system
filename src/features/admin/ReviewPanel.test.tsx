import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import type { AdminBooking, AdminPayment } from './api'
import { ReviewPanel, type ProofLink } from './ReviewPanel'

const pendingProof: AdminPayment = {
  id: 'p1', method: 'gcash', amount: 900, reference_number: '1234', storage_path: 'b1/proof.png',
  submitted_at: '2030-01-07T02:10:00.000Z', review_status: 'pending', review_note: null,
}
const booking: AdminBooking = {
  id: 'b1', reference_code: 'CB-7KQ2XD', court_name: 'Badminton 1',
  slot_start: '2030-01-07T09:00:00.000Z', slot_end: '2030-01-07T11:00:00.000Z',
  status: 'payment_submitted', source: 'online', total_amount: 900, expires_at: null, rejection_count: 0,
  guest_name: 'Gina Guest', guest_email: 'gina@example.com', guest_phone: '0917 222 2222',
  created_at: '2030-01-07T02:00:00.000Z', payments: [pendingProof],
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
})
