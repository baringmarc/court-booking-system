// T33.4: the staff cancel form for a booking in a group (SPEC §7 `/admin/bookings`, "Cancel form"): a fully confirmed
// group cancels this court only; a group that isn't (waiting, under review) cancels every active court.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AdminCancelForm } from './AdminCancelForm'

type Group = { courts: number; scope: 'court' | 'checkout' }
const renderForm = (group?: Group, props: { paid?: boolean } = {}) => {
  const onCancel = vi.fn()
  render(<AdminCancelForm paid={props.paid ?? false} group={group} pending={false} error={null} onCancel={onCancel} />)
  return { onCancel }
}

describe('AdminCancelForm in a group', () => {
  it('scope "court": cancels only this court and says how many others stay booked', () => {
    renderForm({ courts: 2, scope: 'court' })
    expect(screen.getByText('Only this court is cancelled. The other 2 courts in this checkout stay booked.')).toBeInTheDocument()
    expect(screen.queryByText(/This cancels all/)).not.toBeInTheDocument()
  })

  it('scope "court" with one other court says "The other court in this checkout stays booked."', () => {
    renderForm({ courts: 1, scope: 'court' })
    expect(screen.getByText('Only this court is cancelled. The other court in this checkout stays booked.')).toBeInTheDocument()
    expect(screen.queryByText(/The other 1 courts/)).not.toBeInTheDocument()
  })

  it('scope "checkout": cancels all N courts because one payment covers them', () => {
    renderForm({ courts: 3, scope: 'checkout' })
    expect(screen.getByText('This cancels all 3 courts in this checkout, because one payment covers them all.')).toBeInTheDocument()
    expect(screen.queryByText(/Only this court is cancelled/)).not.toBeInTheDocument()
  })

  it('keeps the button "Cancel booking" and the reason rule', async () => {
    const { onCancel } = renderForm({ courts: 2, scope: 'checkout' })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }))
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByText('Give a reason so the player knows why.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Reason for cancelling'), 'Court maintenance')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }))
    expect(onCancel).toHaveBeenCalledWith('Court maintenance')
  })

  it('still says a refund will be recorded when a payment was approved', () => {
    renderForm({ courts: 2, scope: 'court' }, { paid: true })
    expect(screen.getByText(/a refund will be recorded for you to settle afterwards/)).toBeInTheDocument()
  })

  it('says nothing about a checkout without `group`', () => {
    renderForm(undefined)
    expect(screen.queryByText(/in this checkout/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Only this court/)).not.toBeInTheDocument()
  })
})
