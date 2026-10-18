import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { PaymongoReturnNotice, PayOnline } from './PayOnline'

describe('PayOnline', () => {
  it('offers PayMongo and starts the checkout on click', async () => {
    const onPay = vi.fn()
    render(<PayOnline pending={false} error={null} onPay={onPay} />)
    expect(screen.getByText(/GCash, Maya, card or QR Ph/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Pay online with PayMongo' }))
    expect(onPay).toHaveBeenCalledOnce()
  })

  it('is disabled while the checkout opens', () => {
    render(<PayOnline pending error={null} onPay={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Opening PayMongo…' })).toBeDisabled()
  })

  it('shows readable errors from the checkout function', () => {
    const { rerender } = render(
      <PayOnline pending={false} onPay={vi.fn()}
        error={new ApiError("Online payment isn't available right now. Please upload a proof instead.", '503', 'payments_unavailable')} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent("Online payment isn't available right now")
    rerender(<PayOnline pending={false} onPay={vi.fn()} error={new ApiError('This hold has expired, so the times were released.', '409', 'hold_expired')} />)
    expect(screen.getByRole('alert')).toHaveTextContent('This hold has expired')
    rerender(<PayOnline pending={false} onPay={vi.fn()} error={new Error('boom')} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
  })
})

describe('PaymongoReturnNotice', () => {
  it.each([
    ['confirming', 'Confirming your payment'],
    ['confirmed', 'Payment received. Your booking is confirmed.'],
    ['not_accepted', 'The venue will arrange a refund'],
    ['timeout', "We haven't heard back from PayMongo yet"],
    ['cancelled', 'Online payment was cancelled'],
  ] as const)('explains the %s return', (state, text) => {
    render(<PaymongoReturnNotice state={state} />)
    expect(screen.getByRole('status')).toHaveTextContent(text)
  })

  it('renders nothing when not returning from PayMongo', () => {
    const { container } = render(<PaymongoReturnNotice state={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
