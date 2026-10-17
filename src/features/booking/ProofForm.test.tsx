import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { ProofForm } from './ProofForm'

beforeAll(() => {
  // jsdom has no object URLs; the preview only needs a string.
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

const png = () => new File([new Uint8Array(100)], 'receipt.png', { type: 'image/png' })
const renderForm = (props: Partial<Parameters<typeof ProofForm>[0]> = {}) => {
  const onSubmit = vi.fn()
  render(<ProofForm total={900} currency="PHP" pending={false} error={null} onSubmit={onSubmit} {...props} />)
  return onSubmit
}

describe('ProofForm', () => {
  it('prefills the amount and requires a method and a file', async () => {
    const onSubmit = renderForm()
    expect(screen.getByLabelText('Amount paid')).toHaveValue(900)
    await userEvent.click(screen.getByRole('button', { name: 'Submit proof of payment' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Paid with')).toHaveAccessibleDescription('Choose how you paid.')
    expect(screen.getByLabelText(/Receipt screenshot/)).toHaveAccessibleDescription('Attach a screenshot or PDF of your receipt.')
  })

  it('warns, without blocking, when the amount differs from the total', async () => {
    const onSubmit = renderForm()
    const amount = screen.getByLabelText('Amount paid')
    await userEvent.clear(amount)
    await userEvent.type(amount, '850')
    expect(screen.getByRole('status')).toHaveTextContent('different from the total of ₱900')
    await userEvent.selectOptions(screen.getByLabelText('Paid with'), 'maya')
    await userEvent.upload(screen.getByLabelText(/Receipt screenshot/), png())
    await userEvent.click(screen.getByRole('button', { name: 'Submit proof of payment' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ method: 'maya', amount: 850, referenceNumber: '' }))
  })

  it('shows an image preview and submits the chosen file', async () => {
    const onSubmit = renderForm()
    const file = png()
    await userEvent.selectOptions(screen.getByLabelText('Paid with'), 'gcash')
    await userEvent.type(screen.getByLabelText('Reference number (optional)'), '1234')
    await userEvent.upload(screen.getByLabelText(/Receipt screenshot/), file)
    expect(screen.getByRole('img', { name: 'Preview of your receipt' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Submit proof of payment' }))
    expect(onSubmit).toHaveBeenCalledWith({ method: 'gcash', amount: 900, referenceNumber: '1234', file })
  })

  it('shows server errors and a pending state', () => {
    renderForm({ pending: true, error: new ApiError('This hold has expired, so the times were released.', '409', 'hold_expired') })
    expect(screen.getByRole('alert')).toHaveTextContent('This hold has expired')
    expect(screen.getByRole('button', { name: 'Uploading…' })).toBeDisabled()
  })
})
