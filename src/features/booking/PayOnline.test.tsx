import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { PaymongoReturnNotice, PayOnline } from './PayOnline'

describe('PayOnline', () => {
  it('offers PayMongo and starts the checkout on click', async () => {
    const onPay = vi.fn()
    render(<PayOnline state="idle" error={null} onPay={onPay} />)
    expect(screen.getByText(/GCash, Maya, card or QR Ph/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Pay online with PayMongo' }))
    expect(onPay).toHaveBeenCalledOnce()
  })

  it('is busy while the checkout opens and while the browser leaves, saying so in a live region', () => {
    const { rerender, container } = render(<PayOnline state="opening" error={null} onPay={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Opening PayMongo…' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Opening PayMongo… This can take a few seconds')
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status').closest('[aria-busy="true"]')).toBeNull() // the live line isn't held back
    expect(container.querySelector('.spinner')).toBeInTheDocument()

    rerender(<PayOnline state="redirecting" error={null} onPay={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Taking you to PayMongo…' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Taking you to PayMongo… This can take a few seconds; please keep this page open.')

    rerender(<PayOnline state="idle" error={null} onPay={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Pay online with PayMongo' })).toBeEnabled()
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'false')
    expect(container.querySelector('.spinner')).not.toBeInTheDocument()
  })

  it('shows readable errors from the checkout function', () => {
    const { rerender } = render(
      <PayOnline state="idle" onPay={vi.fn()}
        error={new ApiError("Online payment isn't available right now. Please upload a proof instead.", '503', 'payments_unavailable')} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent("Online payment isn't available right now")
    rerender(<PayOnline state="idle" onPay={vi.fn()} error={new ApiError('This hold has expired, so the times were released.', '409', 'hold_expired')} />)
    expect(screen.getByRole('alert')).toHaveTextContent('This hold has expired')
    rerender(<PayOnline state="idle" onPay={vi.fn()} error={new Error('boom')} />)
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
