// T11.28: "Paid with" lists the venue's payment accounts and submits the account id; with none it keeps the old list.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { fetchPaymentAccounts, type PaymentAccount } from '../venue/api'
import { ProofForm } from './ProofForm'

vi.mock('../venue/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchPaymentAccounts: vi.fn() }))

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

const account = (id: string, label: string, position: number): PaymentAccount =>
  ({ id, label, account_name: '', account_number: '', qr_path: null, position })
// Deliberately not alphabetical: the order comes from the server (admin order).
const accounts = [account('a-2', 'Metrobank', 0), account('a-1', 'GCash Business', 1), account('a-3', 'BPI', 2)]

const png = () => new File([new Uint8Array(100)], 'receipt.png', { type: 'image/png' })

function renderForm() {
  const onSubmit = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ProofForm total={900} currency="PHP" pending={false} error={null} onSubmit={onSubmit} />
    </QueryClientProvider>,
  )
  return onSubmit
}
const optionLabels = (select: HTMLElement) => within(select).getAllByRole('option').map((o) => o.textContent)

beforeEach(() => {
  vi.mocked(fetchPaymentAccounts).mockReset().mockResolvedValue(accounts)
})

describe('ProofForm "Paid with" (T11.28)', () => {
  it('says it is loading the payment options first', async () => {
    renderForm()
    expect(screen.getByRole('status')).toHaveTextContent('Loading payment options…')
    await screen.findByLabelText('Paid with')
  })

  it('lists the venue payment accounts in the returned order', async () => {
    renderForm()
    const select = await screen.findByLabelText('Paid with')
    expect(optionLabels(select)).toEqual(['Choose…', 'Metrobank', 'GCash Business', 'BPI'])
  })

  it('submits the chosen account id and no method', async () => {
    const onSubmit = renderForm()
    const file = png()
    await userEvent.selectOptions(await screen.findByLabelText('Paid with'), 'GCash Business')
    await userEvent.type(screen.getByLabelText('Reference number (optional)'), '99')
    await userEvent.upload(screen.getByLabelText(/Receipt screenshot/), file)
    await userEvent.click(screen.getByRole('button', { name: 'Submit proof of payment' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const values = onSubmit.mock.calls[0][0]
    expect(values).toEqual({ accountId: 'a-1', amount: 900, referenceNumber: '99', file })
    expect(values.method).toBeUndefined()
  })

  it('still requires a choice before submitting', async () => {
    const onSubmit = renderForm()
    await screen.findByLabelText('Paid with')
    await userEvent.upload(screen.getByLabelText(/Receipt screenshot/), png())
    await userEvent.click(screen.getByRole('button', { name: 'Submit proof of payment' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Paid with')).toHaveAccessibleDescription('Choose how you paid.')
  })

  it('keeps GCash / Maya / Bank transfer when the venue lists no accounts, and sends the method', async () => {
    vi.mocked(fetchPaymentAccounts).mockResolvedValue([])
    const onSubmit = renderForm()
    const select = await screen.findByLabelText('Paid with')
    expect(optionLabels(select)).toEqual(['Choose…', 'GCash', 'Maya', 'Bank transfer'])
    const file = png()
    await userEvent.selectOptions(select, 'maya')
    await userEvent.upload(screen.getByLabelText(/Receipt screenshot/), file)
    await userEvent.click(screen.getByRole('button', { name: 'Submit proof of payment' }))
    const values = onSubmit.mock.calls[0][0]
    expect(values).toEqual({ method: 'maya', amount: 900, referenceNumber: '', file })
    expect(values.accountId).toBeUndefined()
  })

  it('shows a load error with a retry, then the accounts', async () => {
    vi.mocked(fetchPaymentAccounts).mockRejectedValue(new ApiError('Network down'))
    renderForm()
    expect(await screen.findByText(/Network down/)).toBeInTheDocument()
    vi.mocked(fetchPaymentAccounts).mockResolvedValue(accounts)
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(optionLabels(await screen.findByLabelText('Paid with'))).toContain('Metrobank')
  })
})
