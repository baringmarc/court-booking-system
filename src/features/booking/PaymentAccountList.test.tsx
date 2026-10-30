import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { fetchPaymentAccounts, type PaymentAccount } from '../venue/api'
import { PaymentAccountList } from './PaymentAccountList'

vi.mock('../venue/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchPaymentAccounts: vi.fn(),
  qrImageUrl: (path: string) => `https://cdn.test/qr/${path}`,
  qrDownloadUrl: (path: string, label: string) => `https://cdn.test/qr/${path}?download=${label}`,
}))

const QR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png'
const gcash: PaymentAccount = { id: 'a1', label: 'GCash', account_name: 'Claudex Courts', account_number: '0917 000 0000', qr_path: QR, position: 0 }
const bank: PaymentAccount = { id: 'a2', label: 'BPI', account_name: '', account_number: '1234-5678-90', qr_path: null, position: 1 }

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><PaymentAccountList /></QueryClientProvider>)
}

const card = (name: string) => screen.getByRole('article', { name })
let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.mocked(fetchPaymentAccounts).mockReset().mockResolvedValue([gcash, bank])
  writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => vi.restoreAllMocks())

describe('PaymentAccountList', () => {
  it('says it is loading, then shows a card per account in order', async () => {
    renderList()
    expect(screen.getByRole('status')).toHaveTextContent(/Loading payment options/)
    const list = await screen.findByRole('list', { name: 'Payment accounts' })
    expect(within(list).getAllByRole('article').map((a) => a.getAttribute('aria-labelledby'))).toEqual(['account-a1', 'account-a2'])
    expect(within(card('GCash')).getByText('Claudex Courts')).toBeInTheDocument()
    expect(within(card('GCash')).getByText('0917 000 0000')).toBeInTheDocument()
  })

  it('shows the QR code with a full-size view and a Download QR link', async () => {
    renderList()
    await screen.findByRole('list', { name: 'Payment accounts' })
    const g = card('GCash')
    expect(within(g).getByRole('img', { name: 'QR code for GCash' })).toHaveAttribute('src', `https://cdn.test/qr/${QR}`)
    expect(within(g).getByRole('link', { name: 'Download QR' })).toHaveAttribute('href', `https://cdn.test/qr/${QR}?download=GCash`)
    await userEvent.click(within(g).getByRole('button', { name: 'Show the GCash QR code full size' }))
    expect(screen.getByRole('dialog', { name: 'GCash QR code' })).toBeInTheDocument()
  })

  it('shows an account without a QR code as text only', async () => {
    renderList()
    await screen.findByRole('list', { name: 'Payment accounts' })
    const b = card('BPI')
    expect(within(b).queryByRole('img')).not.toBeInTheDocument()
    expect(within(b).queryByRole('link', { name: 'Download QR' })).not.toBeInTheDocument()
    expect(within(b).getByText('1234-5678-90')).toBeInTheDocument()
  })

  it('copies an account number', async () => {
    renderList()
    await screen.findByRole('list', { name: 'Payment accounts' })
    await userEvent.click(within(card('BPI')).getByRole('button', { name: 'Copy the BPI number' }))
    expect(writeText).toHaveBeenCalledWith('1234-5678-90')
    expect(within(card('BPI')).getByRole('button', { name: 'Copy the BPI number' })).toHaveTextContent('Copied')
  })

  it('says so when copying fails, and goes back to "Copy" so a second copy is announced', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    renderList()
    await screen.findByRole('list', { name: 'Payment accounts' })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const button = within(card('BPI')).getByRole('button', { name: 'Copy the BPI number' })
    fireEvent.click(button)
    await vi.waitFor(() => expect(within(card('BPI')).getAllByText(/Couldn't copy/).length).toBeGreaterThan(0))
    fireEvent.click(button)
    await vi.waitFor(() => expect(button).toHaveTextContent('Copied'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(button).toHaveTextContent('Copy')
    vi.useRealTimers()
  })

  it('hides a QR code whose image fails to load', async () => {
    renderList()
    await screen.findByRole('list', { name: 'Payment accounts' })
    fireEvent.error(within(card('GCash')).getByRole('img', { name: 'QR code for GCash' }))
    expect(within(card('GCash')).queryByRole('img')).not.toBeInTheDocument()
    expect(within(card('GCash')).queryByRole('link', { name: 'Download QR' })).not.toBeInTheDocument()
    expect(within(card('GCash')).getByText('0917 000 0000')).toBeInTheDocument()
  })

  it('renders nothing when the venue lists no accounts', async () => {
    vi.mocked(fetchPaymentAccounts).mockResolvedValue([])
    const { container } = renderList()
    await vi.waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a load error with a retry', async () => {
    vi.mocked(fetchPaymentAccounts).mockRejectedValue(new ApiError('Network down'))
    renderList()
    expect(await screen.findByText(/Network down/)).toBeInTheDocument()
    vi.mocked(fetchPaymentAccounts).mockResolvedValue([bank])
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(await screen.findByRole('article', { name: 'BPI' })).toBeInTheDocument()
  })

  describe('iPhone hint (T11.25)', () => {
    const hintText = /On iPhone, a download goes to Files\. To scan it from Photos instead/
    const toggle = (name = 'GCash') => within(card(name)).getByRole('button', { name: 'How to save to Photos on iPhone' })

    async function ready() {
      renderList()
      await screen.findByRole('list', { name: 'Payment accounts' })
    }

    it('is hidden at first, with the button collapsed', async () => {
      await ready()
      expect(toggle()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText(hintText)).not.toBeInTheDocument()
    })

    it('opens on click with the unchanged text and aria-expanded true', async () => {
      await ready()
      await userEvent.click(toggle())
      expect(toggle()).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText(hintText)).toHaveTextContent('tap the QR code to open it, then press and hold it and choose Save to Photos.')
    })

    it('closes when the button is clicked again', async () => {
      await ready()
      await userEvent.click(toggle())
      await userEvent.click(toggle())
      expect(toggle()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText(hintText)).not.toBeInTheDocument()
    })

    it('closes on Escape and focus stays on the button', async () => {
      await ready()
      await userEvent.click(toggle())
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByText(hintText)).not.toBeInTheDocument()
      expect(toggle()).toHaveAttribute('aria-expanded', 'false')
      expect(toggle()).toHaveFocus()
    })

    it('closes on a click outside, and a click inside the hint keeps it open', async () => {
      await ready()
      await userEvent.click(toggle())
      await userEvent.click(screen.getByText(hintText))
      expect(screen.getByText(hintText)).toBeInTheDocument()
      await userEvent.click(within(card('BPI')).getByText('1234-5678-90'))
      expect(screen.queryByText(hintText)).not.toBeInTheDocument()
      expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    })

    it('is not offered for an account without a QR code', async () => {
      await ready()
      expect(within(card('BPI')).queryByRole('button', { name: 'How to save to Photos on iPhone' })).not.toBeInTheDocument()
    })
  })
})
