import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { CancelBooking } from './CancelBooking'
import type { PlayerCancel } from './cancellation'

const deadline = new Date('2030-01-07T08:00:00.000Z') // 4:00 PM Manila

function renderCancel(check: PlayerCancel, { paid = false, pending = false, error = null as unknown } = {}) {
  const onCancel = vi.fn()
  const view = render(<CancelBooking check={check} timeZone="Asia/Manila" paid={paid} pending={pending} error={error} onCancel={onCancel} />)
  return { onCancel, ...view }
}

describe('CancelBooking', () => {
  it('asks for confirmation before cancelling, with an optional reason', async () => {
    const { onCancel } = renderCancel({ kind: 'allowed', deadline })
    expect(screen.getByText(/cancel online until Mon, Jan 7, 4:00/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }))
    expect(onCancel).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Reason (optional)'), 'Rain')
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel booking' }))
    expect(onCancel).toHaveBeenCalledWith('Rain')
  })

  it('can back out of the confirmation', async () => {
    const { onCancel } = renderCancel({ kind: 'allowed', deadline })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }))
    await userEvent.click(screen.getByRole('button', { name: 'Keep booking' }))
    expect(screen.getByRole('button', { name: 'Cancel booking' })).toBeInTheDocument()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('warns that paid bookings are refunded by the venue, not online', async () => {
    renderCancel({ kind: 'allowed', deadline }, { paid: true })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }))
    expect(screen.getByText(/not refunded online/)).toBeInTheDocument()
  })

  it('explains when the cutoff has passed and offers no button', () => {
    renderCancel({ kind: 'closed', deadline })
    expect(screen.getByText(/Online cancellation closed at Mon, Jan 7, 4:00/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders nothing for a booking that no longer holds the slot', () => {
    const { container } = renderCancel({ kind: 'not_active' })
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the server error and disables the buttons while cancelling', async () => {
    const error = new ApiError('It is too late to cancel online. Please contact the venue.', 'P0001', 'cutoff_passed')
    const { rerender } = renderCancel({ kind: 'allowed', deadline }, { error })
    expect(screen.getByRole('alert')).toHaveTextContent('too late to cancel online')

    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }))
    rerender(<CancelBooking check={{ kind: 'allowed', deadline }} timeZone="Asia/Manila" paid={false} pending error={null} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Keep booking' })).toBeDisabled()
  })
})
