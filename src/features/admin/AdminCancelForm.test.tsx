import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { AdminCancelForm } from './AdminCancelForm'

describe('AdminCancelForm', () => {
  it('requires a reason before cancelling', async () => {
    const onCancel = vi.fn()
    render(<AdminCancelForm paid={false} pending={false} error={null} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }))
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Reason for cancelling')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Give a reason so the player knows why.')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Reason for cancelling'), '  Court maintenance ')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }))
    expect(onCancel).toHaveBeenCalledWith('Court maintenance')
  })

  it('reminds staff that a paid booking is not refunded by cancelling', () => {
    render(<AdminCancelForm paid pending={false} error={null} onCancel={vi.fn()} />)
    expect(screen.getByText(/settle any refund outside the app/)).toBeInTheDocument()
  })

  it('shows the server error and disables the button while cancelling', () => {
    const error = new ApiError('This booking has already ended.', 'P0001', 'booking_ended')
    const { rerender } = render(<AdminCancelForm paid={false} pending={false} error={error} onCancel={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('This booking has already ended.')
    rerender(<AdminCancelForm paid={false} pending error={null} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled()
  })
})
