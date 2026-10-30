// T11.28: the guest's payment history names the payment account used.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PaymentAttempt } from './api'
import { PaymentHistory } from './PaymentHistory'

const attempt = (over: Partial<PaymentAttempt>): PaymentAttempt => ({
  id: 'p1', method: 'account', paid_with: 'BPI Savings', amount: 900, reference_number: null,
  submitted_at: '2030-01-07T02:00:00.000Z', review_status: 'pending', reviewed_at: null, review_note: null, ...over,
})
const renderHistory = (payments: PaymentAttempt[]) =>
  render(<PaymentHistory payments={payments} timeZone="Asia/Manila" currency="PHP" />)

describe('PaymentHistory paid with', () => {
  it('shows the account label instead of the method', () => {
    renderHistory([attempt({})])
    expect(screen.getByText('BPI Savings · ₱900')).toBeInTheDocument()
    expect(screen.queryByText(/Payment account/)).not.toBeInTheDocument()
  })

  it('shows the method label when there is no paid_with', () => {
    renderHistory([attempt({ method: 'maya', paid_with: null })])
    expect(screen.getByText('Maya · ₱900')).toBeInTheDocument()
  })
})
