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

  it('tells staff that cancelling a paid booking records a refund for them to settle afterwards (T30.6)', () => {
    render(<AdminCancelForm paid pending={false} error={null} onCancel={vi.fn()} />)
    expect(screen.getByText(/A payment was already approved: a refund will be recorded for you to settle afterwards\./)).toBeInTheDocument()
    expect(screen.queryByText(/outside the app/)).not.toBeInTheDocument()
  })

  it('has no refund hint for a booking nobody paid', () => {
    render(<AdminCancelForm paid={false} pending={false} error={null} onCancel={vi.fn()} />)
    expect(screen.queryByText(/refund/)).not.toBeInTheDocument()
  })

  it('warns that moved parts stay booked, naming them', () => {
    const { rerender } = render(<AdminCancelForm paid={false} movedParts={['CB-MOVEDA']} pending={false} error={null} onCancel={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('The moved part CB-MOVEDA stay booked: cancel it separately if they should go too.')
    rerender(<AdminCancelForm paid={false} movedParts={['CB-MOVEDA', 'CB-MOVEDB']} pending={false} error={null} onCancel={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('The moved parts CB-MOVEDA, CB-MOVEDB stay booked: cancel them separately')
    rerender(<AdminCancelForm paid={false} pending={false} error={null} onCancel={vi.fn()} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows the server error and disables the button while cancelling', () => {
    const error = new ApiError('This booking has already ended.', 'P0001', 'booking_ended')
    const { rerender } = render(<AdminCancelForm paid={false} pending={false} error={error} onCancel={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('This booking has already ended.')
    rerender(<AdminCancelForm paid={false} pending error={null} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled()
  })
})
