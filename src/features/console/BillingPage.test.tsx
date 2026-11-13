// T26.5: Plotline's own payment accounts, shown on every invoice PDF (platform_payment_accounts, bucket platform-billing).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { menuMove } from '../../test/reorder'
import { prepareQrImage } from '../admin/qrImage'
import {
  deletePlatformPaymentAccount, fetchPlatformPaymentAccounts, reorderPlatformPaymentAccounts, savePlatformPaymentAccount,
  type PlatformPaymentAccount,
} from './api'
import { BillingPage } from './BillingPage'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchPlatformPaymentAccounts: vi.fn(),
  savePlatformPaymentAccount: vi.fn(),
  deletePlatformPaymentAccount: vi.fn(),
  reorderPlatformPaymentAccounts: vi.fn(),
  platformQrUrl: vi.fn(async (path: string) => `https://signed.test/platform-billing/${path}`),
}))
vi.mock('../admin/qrImage', async (importOriginal) => ({ ...(await importOriginal<object>()), prepareQrImage: vi.fn() }))

const QR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png'
const account = (id: string, label: string, position: number, patch: Partial<PlatformPaymentAccount> = {}): PlatformPaymentAccount =>
  ({ id, label, account_name: 'Plotline Inc.', account_number: `0917 000 000${position}`, qr_path: null, position, ...patch })

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><BillingPage /></QueryClientProvider>)
}

const listLabels = () =>
  within(screen.getByRole('list', { name: 'Payment accounts in order' })).getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent)
const png = () => new File([new Uint8Array(10)], 'qr.png', { type: 'image/png' })

beforeEach(() => {
  vi.mocked(fetchPlatformPaymentAccounts).mockReset().mockResolvedValue([account('a1', 'GCash', 0, { qr_path: QR }), account('a2', 'Maya', 1)])
  vi.mocked(savePlatformPaymentAccount).mockReset().mockResolvedValue({ id: 'a9' })
  vi.mocked(deletePlatformPaymentAccount).mockReset().mockResolvedValue(undefined)
  vi.mocked(reorderPlatformPaymentAccounts).mockReset().mockResolvedValue(undefined)
  vi.mocked(prepareQrImage).mockReset().mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('BillingPage', () => {
  it('has an h1 Billing and a note that the accounts appear on every invoice PDF and sending is blocked until one exists', async () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Billing' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Plotline payment accounts' })).toBeInTheDocument()
    expect(screen.getByText(/every invoice/i)).toBeInTheDocument()
    expect(screen.getByText(/blocked until/i)).toBeInTheDocument()
    await screen.findByRole('list', { name: 'Payment accounts in order' })
  })

  it('shows a loading state, then lists the accounts in order with details and a QR badge', async () => {
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
    await waitFor(() => expect(listLabels()).toEqual(['GCash', 'Maya']))
    expect(screen.getByText('QR')).toBeInTheDocument()
    expect(screen.getByText('Plotline Inc. · 0917 000 0000')).toBeInTheDocument()
  })

  it('empty state says invoices cannot be sent until an account is added, and still offers the add form', async () => {
    vi.mocked(fetchPlatformPaymentAccounts).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/No payment accounts yet/)).toBeInTheDocument()
    expect(screen.getAllByText(/cannot be sent/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('form', { name: 'New payment account' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }))
    expect(savePlatformPaymentAccount).not.toHaveBeenCalled() // the label is required
  })

  it('error state shows the message with a retry that reloads', async () => {
    vi.mocked(fetchPlatformPaymentAccounts).mockRejectedValue(new ApiError('Network down'))
    renderPage()
    expect(await screen.findByText(/Network down/)).toBeInTheDocument()
    vi.mocked(fetchPlatformPaymentAccounts).mockResolvedValue([])
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(await screen.findByText(/No payment accounts yet/)).toBeInTheDocument()
  })

  it('adds an account without a QR code, with trimmed fields', async () => {
    renderPage()
    const form = await screen.findByRole('form', { name: 'New payment account' })
    await userEvent.type(within(form).getByLabelText(/^Label/), ' BPI ')
    await userEvent.type(within(form).getByLabelText('Account name'), ' Plotline Inc. ')
    await userEvent.type(within(form).getByLabelText('Account or mobile number'), ' 1234-5678-90 ')
    await userEvent.click(within(form).getByRole('button', { name: 'Add account' }))
    await waitFor(() => expect(savePlatformPaymentAccount).toHaveBeenCalledTimes(1))
    const [existing, input, qr] = vi.mocked(savePlatformPaymentAccount).mock.calls[0]
    expect(existing).toBeNull()
    expect(input).toEqual({ label: 'BPI', account_name: 'Plotline Inc.', account_number: '1234-5678-90' })
    expect(qr).toEqual({ kind: 'keep' })
    expect(prepareQrImage).not.toHaveBeenCalled()
  })

  it('adds an account with a QR code: previews it, re-encodes it, and saves it as a set change', async () => {
    renderPage()
    const form = await screen.findByRole('form', { name: 'New payment account' })
    await userEvent.type(within(form).getByLabelText(/^Label/), 'BPI')
    const file = png()
    await userEvent.upload(within(form).getByLabelText(/^QR code/), file)
    expect(within(form).getByRole('img', { name: 'QR code for BPI' })).toHaveAttribute('src', 'blob:preview')
    await userEvent.click(within(form).getByRole('button', { name: 'Add account' }))
    await waitFor(() => expect(savePlatformPaymentAccount).toHaveBeenCalledTimes(1))
    expect(prepareQrImage).toHaveBeenCalledWith(file)
    const [existing, input, qr] = vi.mocked(savePlatformPaymentAccount).mock.calls[0]
    expect(existing).toBeNull()
    expect(input).toMatchObject({ label: 'BPI' })
    expect(qr).toEqual({ kind: 'set', image: expect.any(Blob) })
  })

  it('edits an account: shows its signed QR url, and removing the QR saves a clear change', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit GCash' }))
    const form = screen.getByRole('form', { name: 'Edit GCash' })
    await waitFor(() => expect(within(form).getByRole('img', { name: 'QR code for GCash' })).toHaveAttribute('src', `https://signed.test/platform-billing/${QR}`))
    await userEvent.click(within(form).getByRole('button', { name: 'Remove QR code' }))
    await userEvent.click(within(form).getByRole('button', { name: 'Save account' }))
    await waitFor(() => expect(savePlatformPaymentAccount).toHaveBeenCalledTimes(1))
    const [existing, , qr] = vi.mocked(savePlatformPaymentAccount).mock.calls[0]
    expect(existing).toMatchObject({ id: 'a1', qr_path: QR })
    expect(qr).toEqual({ kind: 'clear' })
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit GCash' })).not.toBeInTheDocument())
  })

  it('keeps the edit form open and shows the error when a save fails', async () => {
    vi.mocked(savePlatformPaymentAccount).mockRejectedValue(new ApiError('Plotline can list at most 5 payment accounts.', 'P0001', 'too_many'))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Maya' }))
    const form = screen.getByRole('form', { name: 'Edit Maya' })
    await userEvent.click(within(form).getByRole('button', { name: 'Save account' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('at most 5 payment accounts')
    expect(vi.mocked(savePlatformPaymentAccount).mock.calls[0][2]).toEqual({ kind: 'keep' })
  })

  it('deletes an account only after confirming', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete GCash' }))
    expect(deletePlatformPaymentAccount).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Delete GCash' }))
    await waitFor(() => expect(deletePlatformPaymentAccount).toHaveBeenCalledTimes(1))
    expect(vi.mocked(deletePlatformPaymentAccount).mock.calls[0][0]).toMatchObject({ id: 'a1', qr_path: QR })
    confirm.mockRestore()
  })

  it('reorders with the handle menu and calls the api with the new id order', async () => {
    let saved = [account('a1', 'GCash', 0, { qr_path: QR }), account('a2', 'Maya', 1)]
    vi.mocked(fetchPlatformPaymentAccounts).mockImplementation(async () => saved)
    vi.mocked(reorderPlatformPaymentAccounts).mockImplementation(async (ids) => {
      saved = ids.map((id, i) => ({ ...saved.find((a) => a.id === id)!, position: i }))
    })
    renderPage()
    await waitFor(() => expect(listLabels()).toEqual(['GCash', 'Maya']))
    await menuMove('Maya', 'Move to top')
    expect(reorderPlatformPaymentAccounts).toHaveBeenCalledWith(['a2', 'a1'])
    await waitFor(() => expect(listLabels()).toEqual(['Maya', 'GCash']))
  })

  it('at 5 accounts the add form is replaced by a message about the limit of 5', async () => {
    vi.mocked(fetchPlatformPaymentAccounts).mockResolvedValue(Array.from({ length: 5 }, (_, i) => account(`a${i}`, `Bank ${i}`, i)))
    renderPage()
    expect(await screen.findByText(/up to 5/)).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'New payment account' })).not.toBeInTheDocument()
  })

  it('at 4 accounts the add form is still offered', async () => {
    vi.mocked(fetchPlatformPaymentAccounts).mockResolvedValue(Array.from({ length: 4 }, (_, i) => account(`a${i}`, `Bank ${i}`, i)))
    renderPage()
    expect(await screen.findByRole('form', { name: 'New payment account' })).toBeInTheDocument()
  })
})
