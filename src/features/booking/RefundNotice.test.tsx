// T30.6: the Refund card on /booking/:ref.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parsePlayerRefund, type PlayerRefund } from './refund'
import { RefundNotice } from './RefundNotice'

const renderNotice = (refund: PlayerRefund | null) =>
  render(<RefundNotice refund={refund} timeZone="Asia/Manila" currency="PHP" />)

describe('RefundNotice', () => {
  it('renders nothing without a refund', () => {
    const { container } = renderNotice(null)
    expect(container).toBeEmptyDOMElement()
  })

  it('says the venue owes a refund', () => {
    renderNotice({ status: 'owed', amount: 350, method: null, settled_on: null, reason: null })
    const card = screen.getByRole('region', { name: 'Refund' })
    expect(card).toHaveClass('card')
    expect(screen.getByRole('heading', { name: 'Refund', level: 2 })).toBeInTheDocument()
    expect(card).toHaveTextContent('The venue owes you a refund of ₱350')
  })

  it('says how it was refunded and when', () => {
    renderNotice({ status: 'settled', amount: 350, method: 'gcash', settled_on: '2030-01-07', reason: null })
    expect(screen.getByRole('region', { name: 'Refund' })).toHaveTextContent('Refunded ₱350 by GCash on Mon, Jan 7')
  })

  it('gives the reason when there is no refund', () => {
    renderNotice({ status: 'not_refunded', amount: 350, method: null, settled_on: null, reason: 'Court was flooded' })
    expect(screen.getByRole('region', { name: 'Refund' })).toHaveTextContent('No refund: Court was flooded')
  })

  it('never shows a staff note that came along in the data', () => {
    const refund = parsePlayerRefund({
      status: 'settled', amount: 350, method: 'gcash', settled_on: '2030-01-07', reason: null, note: 'STAFF ONLY: owner said ok', recorded_by: 'admin-1',
    })
    const { container } = renderNotice(refund)
    expect(container).toHaveTextContent('Refunded ₱350 by GCash')
    expect(container.textContent).not.toMatch(/STAFF ONLY|owner said ok|admin-1/)
  })
})
