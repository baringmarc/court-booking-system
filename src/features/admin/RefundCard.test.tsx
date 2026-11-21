// T30.6: the Refund card in the admin booking panel: every refund state, the Mark refunded and Not refunded forms
// (validation, defaults, what is sent), Reopen, the pending and error states, and the remount after a save.
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import type { AdminPayment, AdminRefund, UpdateRefundInput } from './api'
import { RefundCard } from './RefundCard'

const payment = (overrides: Partial<AdminPayment> = {}): AdminPayment => ({
  id: 'p1', method: 'gcash', amount: 900, reference_number: '1234', storage_path: null,
  submitted_at: '2030-01-07T02:10:00.000Z', review_status: 'approved', review_note: null,
  reviewed_at: '2030-01-07T02:20:00.000Z', reviewed_by: 'admin-1', provider_payment_id: null, provider_source: null,
  ...overrides,
})
const refund = (overrides: Partial<AdminRefund> = {}): AdminRefund => ({
  id: 'r1', payment_id: 'p1', amount: 900, status: 'owed', method: null, settled_on: null, reason: null, note: null,
  updated_at: '2030-01-07T02:00:00.000Z', ...overrides,
})

// The venue date is 2030-01-07 (it is still 2030-01-06 in UTC before 8 AM in Manila).
const TODAY = '2030-01-07'

type Overrides = Partial<{
  refunds: AdminRefund[]; payments: AdminPayment[]; pending: boolean; error: unknown; onUpdate: (input: UpdateRefundInput) => void
}>
function props(overrides: Overrides = {}) {
  return {
    refunds: [refund()], payments: [payment()], timeZone: 'Asia/Manila', currency: 'PHP', today: TODAY,
    pending: false, error: null as unknown, onUpdate: vi.fn() as (input: UpdateRefundInput) => void, ...overrides,
  }
}
function renderCard(overrides: Overrides = {}) {
  const p = props(overrides)
  const view = render(<RefundCard {...p} />)
  return { ...view, onUpdate: p.onUpdate as ReturnType<typeof vi.fn>, p }
}

/** The value next to a label in the card's facts. */
function fact(label: string, scope: ReturnType<typeof within> = within(screen.getByRole('region', { name: 'Refund' }))) {
  const term = scope.getByText(label, { selector: 'dt' })
  return term.parentElement?.querySelector('dd')?.textContent
}
const sent = (onUpdate: ReturnType<typeof vi.fn>) => onUpdate.mock.calls[0][0] as UpdateRefundInput

describe('RefundCard: what it shows', () => {
  it('renders nothing when the booking has no refund', () => {
    const { container } = renderCard({ refunds: [] })
    expect(container).toBeEmptyDOMElement()
  })

  it('shows an owed refund with what was paid, the amount and the status', () => {
    renderCard({ refunds: [refund({ amount: 600 })] })
    expect(screen.getByRole('region', { name: 'Refund' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Refund', level: 3 })).toBeInTheDocument()
    expect(fact('Paid')).toBe('₱900')
    expect(fact('Refund')).toBe('₱600')
    expect(fact('Status')).toBe('Refund owed')
    expect(screen.getByText('Refund owed', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark refunded' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Not refunded' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit refund' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reopen as owed' })).not.toBeInTheDocument()
    expect(screen.queryByText('Staff note')).not.toBeInTheDocument()
  })

  it('shows a settled refund with who refunded it and when, and Edit refund / Reopen as owed', () => {
    renderCard({ refunds: [refund({ status: 'settled', method: 'maya', settled_on: '2030-01-07', amount: 850 })] })
    expect(fact('Status')).toBe('Refunded')
    expect(fact('Refund')).toBe('₱850')
    expect(fact('Refunded by')).toBe('Maya')
    expect(fact('Refunded on')).toBe('Mon, Jan 7')
    expect(screen.getByRole('button', { name: 'Edit refund' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reopen as owed' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark refunded' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Not refunded' })).not.toBeInTheDocument()
  })

  it('shows a not-refunded refund with its reason, and Edit refund / Reopen as owed', () => {
    renderCard({ refunds: [refund({ status: 'not_refunded', reason: 'Court was flooded' })] })
    expect(fact('Status')).toBe('Not refunded')
    expect(fact('Reason')).toBe('Court was flooded')
    expect(screen.getByRole('button', { name: 'Edit refund' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reopen as owed' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark refunded' })).not.toBeInTheDocument()
  })

  it('shows the staff note when there is one', () => {
    renderCard({ refunds: [refund({ note: 'Called the player' })] })
    expect(fact('Staff note')).toBe('Called the player')
  })

  it('names each refund by its payment when there are several', () => {
    renderCard({
      refunds: [refund({ id: 'r1', payment_id: 'p1', amount: 500 }), refund({ id: 'r2', payment_id: 'p2', amount: 400, status: 'settled', method: 'cash', settled_on: '2030-01-06' })],
      payments: [payment({ id: 'p1', amount: 500 }), payment({ id: 'p2', method: 'account', paid_with: 'BPI Savings', amount: 400 })],
    })
    const first = screen.getByRole('region', { name: 'Refund: GCash · ₱500' })
    const second = screen.getByRole('region', { name: 'Refund: BPI Savings · ₱400' })
    expect(within(first).getByRole('heading', { name: 'Refund: GCash · ₱500', level: 3 })).toBeInTheDocument()
    expect(within(second).getByRole('heading', { name: 'Refund: BPI Savings · ₱400', level: 3 })).toBeInTheDocument()
    expect(fact('Paid', within(first))).toBe('₱500')
    expect(fact('Status', within(first))).toBe('Refund owed')
    expect(fact('Status', within(second))).toBe('Refunded')
    expect(fact('Refunded by', within(second))).toBe('Cash')
    // Each block has its own buttons.
    expect(within(first).getByRole('button', { name: 'Mark refunded' })).toBeInTheDocument()
    expect(within(second).getByRole('button', { name: 'Edit refund' })).toBeInTheDocument()
  })
})

describe('RefundCard: Mark refunded', () => {
  it('opens a form with the amount, a method to choose, today as the date and the staff note', async () => {
    renderCard({ refunds: [refund({ amount: 600, note: 'Called the player' })] })
    expect(screen.queryByRole('form', { name: 'Mark refunded' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Mark refunded' }))
    const form = within(screen.getByRole('form', { name: 'Mark refunded' }))
    expect(form.getByLabelText('Amount refunded')).toHaveValue(600)
    const method = form.getByLabelText('Refunded by')
    expect(method).toHaveValue('')
    expect(within(method).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose…', 'GCash', 'Maya', 'Bank transfer', 'Cash', 'PayMongo'])
    expect(form.getByLabelText('Date refunded')).toHaveValue(TODAY)
    expect(form.getByLabelText('Staff note (not shown to the player)')).toHaveValue('Called the player')
    expect(form.getByRole('button', { name: 'Save refund' })).toBeInTheDocument()
    expect(form.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('Cancel closes the form without saving', async () => {
    const { onUpdate } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Mark refunded' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Mark refunded' })).not.toBeInTheDocument()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('with no method chosen shows the error on the field and does not save', async () => {
    const { onUpdate } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Mark refunded' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save refund' }))
    expect(onUpdate).not.toHaveBeenCalled()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Choose how the refund was made.')
    expect(alert).toHaveClass('form-error')
    const method = screen.getByLabelText('Refunded by')
    expect(method).toHaveAttribute('aria-invalid', 'true')
    expect(method).toHaveAccessibleDescription('Choose how the refund was made.')
    expect(screen.getByLabelText('Amount refunded')).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('rejects an amount of 0, a blank amount and more than was paid, naming the most', async () => {
    const { onUpdate } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Mark refunded' }))
    await userEvent.selectOptions(screen.getByLabelText('Refunded by'), 'gcash')
    const amount = screen.getByLabelText('Amount refunded')
    for (const text of ['0', '1000', '']) {
      await userEvent.clear(amount)
      if (text) await userEvent.type(amount, text)
      await userEvent.click(screen.getByRole('button', { name: 'Save refund' }))
      expect(screen.getByRole('alert'), `amount "${text}"`).toHaveTextContent('Enter an amount above 0, up to ₱900.')
      expect(amount).toHaveAttribute('aria-invalid', 'true')
      expect(amount).toHaveAccessibleDescription('Enter an amount above 0, up to ₱900.')
    }
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('rejects a date after today', async () => {
    const { onUpdate } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Mark refunded' }))
    await userEvent.selectOptions(screen.getByLabelText('Refunded by'), 'cash')
    fireEvent.change(screen.getByLabelText('Date refunded'), { target: { value: '2030-01-08' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save refund' }))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Choose the date the refund was made, today or earlier.')
    expect(screen.getByLabelText('Date refunded')).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows every problem at once, then clears them when the form is valid', async () => {
    const { onUpdate } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Mark refunded' }))
    await userEvent.clear(screen.getByLabelText('Amount refunded'))
    fireEvent.change(screen.getByLabelText('Date refunded'), { target: { value: '' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save refund' }))
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual([
      'Enter an amount above 0, up to ₱900.', 'Choose how the refund was made.', 'Choose the date the refund was made, today or earlier.',
    ])
    await userEvent.type(screen.getByLabelText('Amount refunded'), '900')
    await userEvent.selectOptions(screen.getByLabelText('Refunded by'), 'gcash')
    fireEvent.change(screen.getByLabelText('Date refunded'), { target: { value: TODAY } })
    await userEvent.click(screen.getByRole('button', { name: 'Save refund' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onUpdate).toHaveBeenCalledOnce()
  })

  it('saves the full amount with the chosen method and today, and sends no note when the note did not change', async () => {
    const { onUpdate } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Mark refunded' }))
    await userEvent.selectOptions(screen.getByLabelText('Refunded by'), 'gcash')
    await userEvent.click(screen.getByRole('button', { name: 'Save refund' }))
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(sent(onUpdate)).toEqual({ refundId: 'r1', status: 'settled', amount: 900, method: 'gcash', settledOn: TODAY })
    expect('note' in sent(onUpdate)).toBe(false)
  })

  it('saves a part refund with centavos on an earlier date, and a trimmed new note', async () => {
    const { onUpdate } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Mark refunded' }))
    await userEvent.clear(screen.getByLabelText('Amount refunded'))
    await userEvent.type(screen.getByLabelText('Amount refunded'), '450.5')
    await userEvent.selectOptions(screen.getByLabelText('Refunded by'), 'bank_transfer')
    fireEvent.change(screen.getByLabelText('Date refunded'), { target: { value: '2030-01-05' } })
    await userEvent.type(screen.getByLabelText('Staff note (not shown to the player)'), '  Sent by bank  ')
    await userEvent.click(screen.getByRole('button', { name: 'Save refund' }))
    expect(sent(onUpdate)).toEqual({
      refundId: 'r1', status: 'settled', amount: 450.5, method: 'bank_transfer', settledOn: '2030-01-05', note: 'Sent by bank',
    })
  })

  it('sends an emptied note as an empty string, so it is cleared', async () => {
    const { onUpdate } = renderCard({ refunds: [refund({ note: 'Called the player' })] })
    await userEvent.click(screen.getByRole('button', { name: 'Mark refunded' }))
    await userEvent.selectOptions(screen.getByLabelText('Refunded by'), 'maya')
    await userEvent.clear(screen.getByLabelText('Staff note (not shown to the player)'))
    await userEvent.click(screen.getByRole('button', { name: 'Save refund' }))
    expect(sent(onUpdate)).toMatchObject({ status: 'settled', note: '' })
  })

  it('leaves a seeded note out when it is unchanged', async () => {
    const { onUpdate } = renderCard({ refunds: [refund({ note: 'Called the player' })] })
    await userEvent.click(screen.getByRole('button', { name: 'Mark refunded' }))
    await userEvent.selectOptions(screen.getByLabelText('Refunded by'), 'maya')
    await userEvent.click(screen.getByRole('button', { name: 'Save refund' }))
    expect('note' in sent(onUpdate)).toBe(false)
  })

  it('Edit refund on a settled refund opens the same form with its values, and saves them', async () => {
    const { onUpdate } = renderCard({ refunds: [refund({ status: 'settled', method: 'maya', settled_on: '2030-01-05', amount: 850 })] })
    await userEvent.click(screen.getByRole('button', { name: 'Edit refund' }))
    const form = within(screen.getByRole('form', { name: 'Mark refunded' }))
    expect(form.getByLabelText('Amount refunded')).toHaveValue(850)
    expect(form.getByLabelText('Refunded by')).toHaveValue('maya')
    expect(form.getByLabelText('Date refunded')).toHaveValue('2030-01-05')
    await userEvent.selectOptions(form.getByLabelText('Refunded by'), 'cash')
    await userEvent.click(form.getByRole('button', { name: 'Save refund' }))
    expect(sent(onUpdate)).toEqual({ refundId: 'r1', status: 'settled', amount: 850, method: 'cash', settledOn: '2030-01-05' })
  })
})

describe('RefundCard: Not refunded', () => {
  it('opens a form with the reason (shown to the player) and the staff note', async () => {
    renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Not refunded' }))
    const form = within(screen.getByRole('form', { name: 'Not refunded' }))
    expect(form.getByLabelText('Reason (shown to the player)')).toHaveAttribute('maxlength', '500')
    expect(form.getByLabelText('Reason (shown to the player)')).toHaveValue('')
    expect(form.getByLabelText('Staff note (not shown to the player)')).toHaveValue('')
    expect(form.getByRole('button', { name: 'Save as not refunded' })).toBeInTheDocument()
    expect(form.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('asks for a reason, linked to the field, and does not save without one', async () => {
    const { onUpdate } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Not refunded' }))
    await userEvent.type(screen.getByLabelText('Reason (shown to the player)'), '   ')
    await userEvent.click(screen.getByRole('button', { name: 'Save as not refunded' }))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Give a reason so the player knows why.')
    expect(screen.getByRole('alert')).toHaveClass('form-error')
    const reason = screen.getByLabelText('Reason (shown to the player)')
    expect(reason).toHaveAttribute('aria-invalid', 'true')
    expect(reason).toHaveAccessibleDescription('Give a reason so the player knows why.')
  })

  it('saves the trimmed reason and no note when the note did not change', async () => {
    const { onUpdate } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Not refunded' }))
    await userEvent.type(screen.getByLabelText('Reason (shown to the player)'), '  E2E court was flooded ')
    await userEvent.click(screen.getByRole('button', { name: 'Save as not refunded' }))
    expect(sent(onUpdate)).toEqual({ refundId: 'r1', status: 'not_refunded', reason: 'E2E court was flooded' })
    expect('note' in sent(onUpdate)).toBe(false)
  })

  it('sends a changed staff note with the reason', async () => {
    const { onUpdate } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Not refunded' }))
    await userEvent.type(screen.getByLabelText('Reason (shown to the player)'), 'Played the full hour')
    await userEvent.type(screen.getByLabelText('Staff note (not shown to the player)'), ' Owner agreed ')
    await userEvent.click(screen.getByRole('button', { name: 'Save as not refunded' }))
    expect(sent(onUpdate)).toEqual({ refundId: 'r1', status: 'not_refunded', reason: 'Played the full hour', note: 'Owner agreed' })
  })

  it('Cancel closes it', async () => {
    renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Not refunded' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Not refunded' })).not.toBeInTheDocument()
  })

  it('Edit refund on a not-refunded refund opens the Not refunded form seeded with its reason', async () => {
    const { onUpdate } = renderCard({ refunds: [refund({ status: 'not_refunded', reason: 'Court was flooded', note: 'Checked' })] })
    await userEvent.click(screen.getByRole('button', { name: 'Edit refund' }))
    const form = within(screen.getByRole('form', { name: 'Not refunded' }))
    expect(form.getByLabelText('Reason (shown to the player)')).toHaveValue('Court was flooded')
    expect(form.getByLabelText('Staff note (not shown to the player)')).toHaveValue('Checked')
    await userEvent.clear(form.getByLabelText('Reason (shown to the player)'))
    await userEvent.type(form.getByLabelText('Reason (shown to the player)'), 'Played the full hour')
    await userEvent.click(form.getByRole('button', { name: 'Save as not refunded' }))
    expect(sent(onUpdate)).toEqual({ refundId: 'r1', status: 'not_refunded', reason: 'Played the full hour' })
  })
})

describe('RefundCard: Reopen as owed', () => {
  it('reopens at once, with no form', async () => {
    const { onUpdate } = renderCard({ refunds: [refund({ status: 'settled', method: 'gcash', settled_on: '2030-01-07' })] })
    await userEvent.click(screen.getByRole('button', { name: 'Reopen as owed' }))
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(sent(onUpdate)).toEqual({ refundId: 'r1', status: 'owed' })
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })

  it('reopens the right refund when there are several', async () => {
    const { onUpdate } = renderCard({
      refunds: [refund({ id: 'r1', payment_id: 'p1' }), refund({ id: 'r2', payment_id: 'p2', status: 'not_refunded', reason: 'No' })],
      payments: [payment({ id: 'p1' }), payment({ id: 'p2', method: 'cash' })],
    })
    await userEvent.click(screen.getByRole('button', { name: 'Reopen as owed' }))
    expect(sent(onUpdate)).toEqual({ refundId: 'r2', status: 'owed' })
  })
})

describe('RefundCard: pending and errors', () => {
  const submitOf = (name: string) => screen.getByRole('form', { name }).querySelector('button[type="submit"]')

  it('disables the Mark refunded submit while saving', async () => {
    const { rerender, p } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Mark refunded' }))
    expect(submitOf('Mark refunded')).toBeEnabled()
    rerender(<RefundCard {...p} pending />)
    expect(submitOf('Mark refunded')).toBeDisabled()
  })

  it('disables the Not refunded submit while saving', async () => {
    const { rerender, p } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Not refunded' }))
    expect(submitOf('Not refunded')).toBeEnabled()
    rerender(<RefundCard {...p} pending />)
    expect(submitOf('Not refunded')).toBeDisabled()
  })

  it('disables Reopen as owed while saving', () => {
    renderCard({ pending: true, refunds: [refund({ status: 'settled', method: 'gcash', settled_on: '2030-01-07' })] })
    expect(screen.getByRole('button', { name: 'Reopen as owed' })).toBeDisabled()
  })

  it.each([
    ['invalid_amount', 'Enter an amount above 0 and no more than what was paid.'],
    ['missing_method', 'Choose how the refund was made.'],
    ['missing_reason', 'Give a reason so the player knows why.'],
  ])('shows the server message for %s in an alert', (hint, message) => {
    renderCard({ error: new ApiError(message, 'P0001', hint) })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(message)
    expect(alert).toHaveClass('alert', 'alert-error')
  })

  it('shows the generic line for an error it does not know', () => {
    renderCard({ error: new TypeError('Failed to fetch') })
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please check your connection and try again.')
  })

  it('shows no alert without an error', () => {
    renderCard()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('RefundCard: after a save', () => {
  it('closes the forms when the refetched refund arrives, and shows its new state', async () => {
    const { rerender, p } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Mark refunded' }))
    expect(screen.getByRole('form', { name: 'Mark refunded' })).toBeInTheDocument()
    rerender(<RefundCard {...p} refunds={[refund({ status: 'settled', method: 'gcash', settled_on: TODAY, updated_at: '2030-01-07T03:00:00.000Z' })]} />)
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(fact('Status')).toBe('Refunded')
    expect(fact('Refunded by')).toBe('GCash')
    expect(screen.getByRole('button', { name: 'Edit refund' })).toBeInTheDocument()
  })

  it('closes the Not refunded form the same way', async () => {
    const { rerender, p } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Not refunded' }))
    rerender(<RefundCard {...p} refunds={[refund({ status: 'not_refunded', reason: 'Flooded', updated_at: '2030-01-07T03:00:00.000Z' })]} />)
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(fact('Status')).toBe('Not refunded')
    expect(fact('Reason')).toBe('Flooded')
  })

  it('keeps an open form and what was typed when the same refund is read again (a background refetch)', async () => {
    const { rerender, p } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Mark refunded' }))
    await userEvent.type(screen.getByLabelText('Staff note (not shown to the player)'), 'Half way typed')
    rerender(<RefundCard {...p} refunds={[refund()]} payments={[payment()]} />)
    expect(screen.getByRole('form', { name: 'Mark refunded' })).toBeInTheDocument()
    expect(screen.getByLabelText('Staff note (not shown to the player)')).toHaveValue('Half way typed')
  })
})
