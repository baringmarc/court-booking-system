import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PaymentAttempt } from './api'
import { PaymentHistory } from './PaymentHistory'
import { SUPERSEDED_PROOF_NOTE } from './paymentLabels'

const attempt = (over: Partial<PaymentAttempt>): PaymentAttempt => ({
  id: 'p1', method: 'gcash', amount: 900, reference_number: null, submitted_at: '2030-01-07T02:00:00.000Z',
  review_status: 'pending', reviewed_at: null, review_note: null, ...over,
})
const renderHistory = (payments: PaymentAttempt[]) =>
  render(<PaymentHistory payments={payments} timeZone="Asia/Manila" currency="PHP" />)

describe('PaymentHistory', () => {
  it('shows a proof closed by an online payment as replaced, not as a rejection', () => {
    renderHistory([
      attempt({ id: 'proof', review_status: 'rejected', review_note: SUPERSEDED_PROOF_NOTE }),
      attempt({ id: 'online', method: 'paymongo', review_status: 'approved', submitted_at: '2030-01-07T02:10:00.000Z' }),
    ])
    const [proof] = screen.getAllByRole('listitem')
    expect(within(proof).getByText('Replaced by online payment')).toBeInTheDocument()
    expect(within(proof).getByText("You paid online instead, so this proof wasn't needed.")).toBeInTheDocument()
    expect(within(proof).queryByText('Not accepted')).not.toBeInTheDocument()
    expect(within(proof).queryByText(/Reason:/)).not.toBeInTheDocument()
  })

  it('still shows an admin rejection with its reason', () => {
    renderHistory([attempt({ review_status: 'rejected', review_note: 'Blurry screenshot' })])
    expect(screen.getByText('Not accepted')).toBeInTheDocument()
    expect(screen.getByText('Reason: Blurry screenshot')).toBeInTheDocument()
  })

  it("doesn't trust the note alone: without an accepted online payment it's a normal rejection", () => {
    renderHistory([attempt({ review_status: 'rejected', review_note: SUPERSEDED_PROOF_NOTE })])
    expect(screen.getByText('Not accepted')).toBeInTheDocument()
    expect(screen.queryByText('Replaced by online payment')).not.toBeInTheDocument()
  })
})
