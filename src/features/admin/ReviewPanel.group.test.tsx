// T33.6: ReviewPanel is the single-booking panel again. Its T33.4 `group` prop (booking X of N, the courts list, the
// checkout total, the summed proof, "This decides all N courts at once.") moved to CheckoutPanel and CheckoutPanel.test.tsx
// (SPEC §10 2026-11-25 "Checkout panel": a behavior change, not a weakened test). What stays here: a booking that belongs
// to a group, shown on its own by ReviewPanel, says nothing about a checkout and keeps its own proof, total and review.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { AdminBooking, AdminPayment } from './api'
import { ReviewPanel, type ProofLink } from './ReviewPanel'

const payment = (id: string, overrides: Partial<AdminPayment> = {}): AdminPayment => ({
  id, method: 'gcash', amount: 360, reference_number: '1234', storage_path: 'a/proof.png', submitted_at: '2030-01-06T19:10:00.000Z',
  review_status: 'pending', review_note: null, reviewed_at: null, reviewed_by: null, provider_payment_id: null, provider_source: null,
  ...overrides,
})

const lead: AdminBooking = {
  id: 'a', reference_code: 'CB-LEAD01', court_id: 'c1', court_name: 'Badminton 1', sport: 'badminton',
  slot_start: '2030-01-06T23:00:00.000Z', slot_end: '2030-01-07T00:00:00.000Z', status: 'payment_submitted', source: 'online',
  total_amount: 350, booking_fee: 10, amount_due: 360, expires_at: null, rejection_count: 0, guest_name: 'Gina Guest',
  guest_email: 'gina@example.com', guest_phone: null, created_at: '2030-01-06T15:00:00.000Z', payments: [payment('pa')], refunds: [],
  cancelled_at: null, cancel_reason: null, cancelled_by_venue: false, parent_booking_id: null, booking_group_id: 'g1',
}

function renderPanel(booking: AdminBooking, proof: ProofLink = { state: 'ready', url: 'https://signed/proof' }) {
  const onApprove = vi.fn()
  const onReject = vi.fn()
  render(
    <MemoryRouter>
      <ReviewPanel booking={booking} timeZone="Asia/Manila" currency="PHP" proof={proof} pending={false} error={null}
        onApprove={onApprove} onReject={onReject} now={new Date('2030-01-06T20:00:00.000Z')} />
    </MemoryRouter>,
  )
  return { onApprove, onReject }
}

describe('ReviewPanel for a booking that has a booking_group_id', () => {
  it('renders as a single booking: no checkout lines, its own total and proof, and its own review', async () => {
    const { onApprove, onReject } = renderPanel(lead)
    expect(screen.queryByText(/in checkout/)).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Courts in this checkout' })).not.toBeInTheDocument()
    expect(screen.queryByText('Checkout total', { selector: 'dt' })).not.toBeInTheDocument()
    expect(screen.queryByText(/This decides all/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'CB-LEAD01' })).toBeInTheDocument()
    expect(screen.getByText(/GCash · ₱360 · Ref 1234/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Proof of payment' })).toHaveAttribute('src', 'https://signed/proof')
    await userEvent.click(screen.getByRole('button', { name: 'Approve and confirm' }))
    expect(onApprove).toHaveBeenCalledOnce()
    await userEvent.type(screen.getByLabelText('Reason for rejecting'), 'Screenshot is cut off')
    await userEvent.click(screen.getByRole('button', { name: 'Reject proof' }))
    expect(onReject).toHaveBeenCalledWith('Screenshot is cut off')
  })

  it('offers no review for a booking whose own payment list is empty (no group to borrow a proof from)', () => {
    renderPanel({ ...lead, payments: [] })
    expect(screen.queryByRole('button', { name: 'Approve and confirm' })).not.toBeInTheDocument()
    expect(screen.getByText('No proof is waiting for review.')).toBeInTheDocument()
  })

  it('has no `group` prop any more (the checkout is CheckoutPanel’s)', async () => {
    const source = await import('./ReviewPanel?raw')
    expect(source.default).not.toMatch(/group\??:\s*AdminGroup/)
    expect(source.default).not.toMatch(/groupPosition/)
  })
})
