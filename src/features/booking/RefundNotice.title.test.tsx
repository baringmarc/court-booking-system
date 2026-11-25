// T33.4: a booking group shows one refund card per court, each titled "Refund: <court name>"; the default title is
// still "Refund".
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RefundNotice } from './RefundNotice'
import type { PlayerRefund } from './refund'

const owed: PlayerRefund = { status: 'owed', amount: 700, method: null, settled_on: null, reason: null }

describe('RefundNotice title', () => {
  it('uses the given title as the card heading and its accessible name', () => {
    render(<RefundNotice refund={owed} timeZone="Asia/Manila" currency="PHP" title="Refund: Tennis Court" />)
    const card = screen.getByRole('region', { name: 'Refund: Tennis Court' })
    expect(card).toHaveTextContent('The venue owes you a refund of ₱700')
    expect(screen.getByRole('heading', { name: 'Refund: Tennis Court' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Refund' })).not.toBeInTheDocument()
  })

  it('defaults to "Refund"', () => {
    render(<RefundNotice refund={owed} timeZone="Asia/Manila" currency="PHP" />)
    expect(screen.getByRole('region', { name: 'Refund' })).toBeInTheDocument()
  })

  it('renders nothing without a refund, whatever the title', () => {
    const { container } = render(<RefundNotice refund={null} timeZone="Asia/Manila" currency="PHP" title="Refund: Tennis Court" />)
    expect(container).toBeEmptyDOMElement()
  })
})
