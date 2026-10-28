import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { menuMove } from '../../test/reorder'
import { fetchPaymentAccounts, type PaymentAccount } from '../venue/api'
import { deletePaymentAccount, reorderPaymentAccounts, savePaymentAccount } from './api'
import { PaymentAccountsSection } from './PaymentAccountsSection'
import { prepareQrImage } from './qrImage'

vi.mock('../venue/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchPaymentAccounts: vi.fn(),
  qrImageUrl: (path: string) => `https://cdn.test/qr/${path}`,
}))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  savePaymentAccount: vi.fn(),
  deletePaymentAccount: vi.fn(),
  reorderPaymentAccounts: vi.fn(),
}))
vi.mock('./qrImage', async (importOriginal) => ({ ...(await importOriginal<object>()), prepareQrImage: vi.fn() }))

const QR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png'
const account = (id: string, label: string, position: number, patch: Partial<PaymentAccount> = {}): PaymentAccount =>
  ({ id, label, account_name: 'Claudex Courts', account_number: `0917 000 000${position}`, qr_path: null, position, ...patch })

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><PaymentAccountsSection /></QueryClientProvider>)
}

const listLabels = () =>
  within(screen.getByRole('list', { name: 'Payment accounts in order' })).getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent)
const png = () => new File([new Uint8Array(10)], 'qr.png', { type: 'image/png' })

beforeEach(() => {
  vi.mocked(fetchPaymentAccounts).mockReset().mockResolvedValue([account('a1', 'GCash', 0, { qr_path: QR }), account('a2', 'Maya', 1)])
  vi.mocked(savePaymentAccount).mockReset().mockResolvedValue({ id: 'a9' })
  vi.mocked(deletePaymentAccount).mockReset().mockResolvedValue(undefined)
  vi.mocked(reorderPaymentAccounts).mockReset().mockResolvedValue(undefined)
  vi.mocked(prepareQrImage).mockReset().mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }))
})
afterEach(() => vi.unstubAllGlobals())

describe('PaymentAccountsSection', () => {
  it('lists the accounts in order, with their details and a QR badge', async () => {
    renderSection()
    expect(screen.getByRole('status')).toBeInTheDocument() // loading
    await waitFor(() => expect(listLabels()).toEqual(['GCash', 'Maya']))
    expect(screen.getByText('QR')).toBeInTheDocument()
    expect(screen.getByText('Claudex Courts · 0917 000 0000')).toBeInTheDocument()
  })

  it('says when there are none, and still offers the add form', async () => {
    vi.mocked(fetchPaymentAccounts).mockResolvedValueOnce([])
    renderSection()
    expect(await screen.findByText(/No payment accounts yet/)).toBeInTheDocument()

    expect(screen.getByRole('form', { name: 'New payment account' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }))
    expect(savePaymentAccount).not.toHaveBeenCalled() // the label is required
  })

  it('shows an error with a retry when the accounts fail to load', async () => {
    vi.mocked(fetchPaymentAccounts).mockRejectedValue(new ApiError('Network down'))
    renderSection()
    expect(await screen.findByText(/Network down/)).toBeInTheDocument()
    vi.mocked(fetchPaymentAccounts).mockResolvedValue([])
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(await screen.findByText(/No payment accounts yet/)).toBeInTheDocument()
  })

  it('adds an account with a QR code: previews it, re-encodes it, and saves the trimmed fields', async () => {
    renderSection()
    const form = await screen.findByRole('form', { name: 'New payment account' })
    await userEvent.type(within(form).getByLabelText(/^Label/), ' BPI ')
    await userEvent.type(within(form).getByLabelText('Account name'), ' Claudex Courts Inc. ')
    await userEvent.type(within(form).getByLabelText('Account or mobile number'), ' 1234-5678-90 ')
    const file = png()
    await userEvent.upload(within(form).getByLabelText(/^QR code/), file)
    expect(within(form).getByRole('img', { name: 'QR code for BPI' })).toHaveAttribute('src', 'blob:preview')
    await userEvent.click(within(form).getByRole('button', { name: 'Add account' }))
    await waitFor(() => expect(savePaymentAccount).toHaveBeenCalledTimes(1))
    expect(prepareQrImage).toHaveBeenCalledWith(file)
    const [existing, input, qr] = vi.mocked(savePaymentAccount).mock.calls[0]
    expect(existing).toBeNull()
    expect(input).toEqual({ label: 'BPI', account_name: 'Claudex Courts Inc.', account_number: '1234-5678-90' })
    expect(qr).toEqual({ kind: 'set', image: expect.any(Blob) })
    await waitFor(() => expect(within(screen.getByRole('form', { name: 'New payment account' })).getByLabelText(/^Label/)).toHaveValue(''))
  })

  it('refuses a file that is not an image, and one that fails to re-encode, without saving', async () => {
    renderSection()
    const form = await screen.findByRole('form', { name: 'New payment account' })
    await userEvent.type(within(form).getByLabelText(/^Label/), 'GCash')
    await userEvent.upload(within(form).getByLabelText(/^QR code/), new File(['%PDF'], 'qr.pdf', { type: 'application/pdf' }), { applyAccept: false })
    expect(within(form).getByRole('alert')).toHaveTextContent(/PNG, JPG or WEBP/)
    expect(within(form).getByLabelText(/^QR code/)).toHaveAttribute('aria-invalid', 'true')

    vi.mocked(prepareQrImage).mockRejectedValue(new Error('The QR image is larger than 1 MB even after resizing.'))
    await userEvent.upload(within(form).getByLabelText(/^QR code/), png())
    await userEvent.click(within(form).getByRole('button', { name: 'Add account' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent(/larger than 1 MB/)
    expect(savePaymentAccount).not.toHaveBeenCalled()
  })

  it('edits an account and removes its QR code', async () => {
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit GCash' }))
    const form = screen.getByRole('form', { name: 'Edit GCash' })
    expect(within(form).getByRole('img', { name: 'QR code for GCash' })).toHaveAttribute('src', `https://cdn.test/qr/${QR}`)
    await userEvent.click(within(form).getByRole('button', { name: 'Remove QR code' }))
    expect(within(form).getByText(/will be removed when you save/)).toBeInTheDocument()
    expect(within(form).getByLabelText(/^QR code/)).toHaveFocus() // the button that had focus is gone
    await userEvent.click(within(form).getByRole('button', { name: 'Save account' }))
    await waitFor(() => expect(savePaymentAccount).toHaveBeenCalledTimes(1))
    const [existing, , qr] = vi.mocked(savePaymentAccount).mock.calls[0]
    expect(existing).toMatchObject({ id: 'a1', qr_path: QR })
    expect(qr).toEqual({ kind: 'clear' })
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit GCash' })).not.toBeInTheDocument())
  })

  it('keeps the edit form open and shows the error when a save fails', async () => {
    vi.mocked(savePaymentAccount).mockRejectedValue(new ApiError('A venue can list at most 10 payment accounts.', 'P0001', 'too_many'))
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Maya' }))
    const form = screen.getByRole('form', { name: 'Edit Maya' })
    await userEvent.click(within(form).getByRole('button', { name: 'Save account' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('at most 10 payment accounts')
    expect(vi.mocked(savePaymentAccount).mock.calls[0][2]).toEqual({ kind: 'keep' })
  })

  it('reorders with the handle menu, and goes back to the saved order if that fails', async () => {
    // The server keeps what was saved, so the refetch after a save returns the new order.
    let saved = [account('a1', 'GCash', 0, { qr_path: QR }), account('a2', 'Maya', 1)]
    vi.mocked(fetchPaymentAccounts).mockImplementation(async () => saved)
    vi.mocked(reorderPaymentAccounts).mockImplementation(async (ids) => {
      saved = ids.map((id, i) => ({ ...saved.find((a) => a.id === id)!, position: i }))
    })
    renderSection()
    await waitFor(() => expect(listLabels()).toEqual(['GCash', 'Maya']))
    await menuMove('Maya', 'Move to top')
    expect(reorderPaymentAccounts).toHaveBeenCalledWith(['a2', 'a1'])
    await waitFor(() => expect(listLabels()).toEqual(['Maya', 'GCash']))

    vi.mocked(reorderPaymentAccounts).mockRejectedValue(new ApiError('The account list is out of date.'))
    await menuMove('Maya', 'Move down')
    expect(await screen.findByText(/out of date/)).toBeInTheDocument()
    await waitFor(() => expect(listLabels()).toEqual(['Maya', 'GCash'])) // the order saved before
  })

  it('deletes an account after confirming', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete GCash' }))
    expect(deletePaymentAccount).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Delete GCash' }))
    expect(vi.mocked(deletePaymentAccount).mock.calls[0][0]).toMatchObject({ id: 'a1', qr_path: QR })
    confirm.mockRestore()
  })

  it('hides the add form at 10 accounts', async () => {
    vi.mocked(fetchPaymentAccounts).mockResolvedValue(Array.from({ length: 10 }, (_, i) => account(`a${i}`, `Bank ${i}`, i)))
    renderSection()
    expect(await screen.findByText(/up to 10 accounts/)).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'New payment account' })).not.toBeInTheDocument()
  })
})
