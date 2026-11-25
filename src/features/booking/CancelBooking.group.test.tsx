// T33.4: cancelling a booking group says it cancels every court (SPEC §7 `/booking/:ref`). A single booking, with or
// without `courts`, reads exactly as before.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CancelBooking } from './CancelBooking'
import type { PlayerCancel } from './cancellation'

const deadline = new Date('2030-01-07T08:00:00.000Z') // 4:00 PM Manila
const allowed: PlayerCancel = { kind: 'allowed', deadline }

function renderCancel(check: PlayerCancel, courts?: number, { pending = false } = {}) {
  const onCancel = vi.fn()
  render(<CancelBooking check={check} timeZone="Asia/Manila" paid={false} pending={pending} error={null} onCancel={onCancel} courts={courts} />)
  return { onCancel }
}

describe('CancelBooking for a group', () => {
  it('says it cancels all N bookings, under the deadline line, with "Cancel all bookings" as the first button', () => {
    renderCancel(allowed, 3)
    const deadlineLine = screen.getByText(/You can cancel online until Mon, Jan 7, 4:00 PM\./)
    const all = screen.getByText('This cancels all 3 bookings.')
    expect(deadlineLine.compareDocumentPosition(all) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel all bookings' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).not.toBeInTheDocument()
  })

  it('asks "Cancel all N bookings?", submits with "Yes, cancel all bookings" and passes the reason', async () => {
    const { onCancel } = renderCancel(allowed, 2)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel all bookings' }))
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByText(/^Cancel all 2 bookings\? The times will be released for others to book\./)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Reason (optional)'), 'Rain')
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel all bookings' }))
    expect(onCancel).toHaveBeenCalledWith('Rain')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('can still back out of the confirmation', async () => {
    const { onCancel } = renderCancel(allowed, 2)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel all bookings' }))
    await userEvent.click(screen.getByRole('button', { name: 'Keep booking' }))
    expect(screen.getByRole('button', { name: 'Cancel all bookings' })).toBeInTheDocument()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('shows "Cancelling…" on the submit button while pending', async () => {
    const view = render(<CancelBooking check={allowed} timeZone="Asia/Manila" paid={false} pending={false} error={null} onCancel={vi.fn()} courts={2} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel all bookings' }))
    view.rerender(<CancelBooking check={allowed} timeZone="Asia/Manila" paid={false} pending error={null} onCancel={vi.fn()} courts={2} />)
    expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled()
  })

  it('says nothing about all courts once the cutoff has passed, and renders nothing when inactive', () => {
    renderCancel({ kind: 'closed', deadline }, 2)
    expect(screen.getByText(/Online cancellation closed at Mon, Jan 7, 4:00/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/This cancels all/)).not.toBeInTheDocument()
  })
})

describe('CancelBooking for a single booking', () => {
  it.each([undefined, 1])('is unchanged with courts = %s', async (courts) => {
    renderCancel(allowed, courts)
    expect(screen.queryByText(/This cancels all/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel all bookings' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }))
    expect(screen.getByText(/^Cancel this booking\? The times will be released for others to book\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Yes, cancel booking' })).toBeInTheDocument()
  })
})
