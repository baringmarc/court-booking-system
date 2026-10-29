// T11.20: the waiver at checkout. Non-blank text needs a ticked box; blank hides it all.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CheckoutForm } from './CheckoutForm'

const contact = { name: 'Pat', email: 'p@example.com', phone: '' }
const WAIVER = 'You play at your own risk.'
const TICK = 'I have read and accept the waiver'

function renderForm(waiverText: string, onSubmit = vi.fn()) {
  render(<CheckoutForm initial={contact} isGuest pending={false} waiverText={waiverText} onSubmit={onSubmit} />)
  return onSubmit
}
const confirm = () => userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }))

describe('CheckoutForm waiver', () => {
  it('shows the text under a Waiver heading with an unticked checkbox', () => {
    renderForm(WAIVER)
    expect(screen.getByRole('heading', { name: 'Waiver' })).toBeInTheDocument()
    expect(screen.getByText(WAIVER)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: TICK })).not.toBeChecked()
  })

  it('refuses to submit unticked and shows the error', async () => {
    const onSubmit = renderForm(WAIVER)
    await confirm()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Tick the box to accept the waiver.')).toBeInTheDocument()
  })

  it('submits with waiverAccepted true once ticked', async () => {
    const onSubmit = renderForm(WAIVER)
    await userEvent.click(screen.getByRole('checkbox', { name: TICK }))
    await confirm()
    expect(onSubmit).toHaveBeenCalledWith(contact, true)
  })

  it('shows no waiver, no checkbox and submits waiverAccepted false when the text is blank', async () => {
    const onSubmit = renderForm('')
    expect(screen.queryByRole('heading', { name: 'Waiver' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await confirm()
    expect(onSubmit).toHaveBeenCalledWith(contact, false)
  })

  it('treats whitespace-only text as blank', async () => {
    const onSubmit = renderForm('  \n ')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await confirm()
    expect(onSubmit).toHaveBeenCalledWith(contact, false)
  })
})
