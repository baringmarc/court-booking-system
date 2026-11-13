// T27.4: with `onSelect`, a card shows its label and a "Pay with this" button; only the chosen card shows the details.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPaymentAccounts, type PaymentAccount } from '../venue/api'
import { PaymentAccountList } from './PaymentAccountList'

vi.mock('../venue/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchPaymentAccounts: vi.fn(),
  qrImageUrl: (path: string) => `https://cdn.test/qr/${path}`,
  qrDownloadUrl: (path: string, label: string) => `https://cdn.test/qr/${path}?download=${label}`,
}))

const gcash: PaymentAccount = { id: 'a1', label: 'GCash', account_name: 'Claudex Courts', account_number: '0917 000 0000', qr_path: 'q1.png', position: 0 }
const bank: PaymentAccount = { id: 'a2', label: 'BPI', account_name: 'Claudex Bank Name', account_number: '1234-5678-90', qr_path: 'q2.png', position: 1 }

function renderList(props: { selectedId?: string | null; onSelect?: (id: string) => void }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><PaymentAccountList {...props} /></QueryClientProvider>)
}
const card = (name: string) => screen.getByRole('article', { name })

beforeEach(() => {
  vi.mocked(fetchPaymentAccounts).mockReset().mockResolvedValue([gcash, bank])
})

describe('PaymentAccountList choosing (T27.4)', () => {
  it('shows only the label and a "Pay with <label>" button on every card while none is chosen', async () => {
    renderList({ selectedId: null, onSelect: vi.fn() })
    await screen.findByRole('list', { name: 'Payment accounts' })
    for (const a of [gcash, bank]) {
      const c = card(a.label)
      expect(within(c).getByText(a.label)).toBeInTheDocument()
      expect(within(c).getByRole('button', { name: `Pay with ${a.label}` })).toBeInTheDocument()
      expect(within(c).queryByText(a.account_number!)).not.toBeInTheDocument()
      expect(within(c).queryByText(a.account_name!)).not.toBeInTheDocument()
      expect(within(c).queryByRole('button', { name: `Copy the ${a.label} number` })).not.toBeInTheDocument()
      expect(within(c).queryByRole('img')).not.toBeInTheDocument()
      expect(within(c).queryByRole('link', { name: 'Download QR' })).not.toBeInTheDocument()
      expect(within(c).queryByRole('button', { name: 'How to save to Photos on iPhone' })).not.toBeInTheDocument()
    }
  })

  it('calls onSelect with the account id when "Pay with this" is pressed', async () => {
    const onSelect = vi.fn()
    renderList({ selectedId: null, onSelect })
    await screen.findByRole('list', { name: 'Payment accounts' })
    await userEvent.click(within(card('BPI')).getByRole('button', { name: 'Pay with BPI' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('a2')
  })

  it('reveals the name, number, Copy, QR, Download QR and the iPhone hint on the chosen card only', async () => {
    renderList({ selectedId: 'a1', onSelect: vi.fn() })
    await screen.findByRole('list', { name: 'Payment accounts' })
    const g = card('GCash')
    expect(within(g).getByText('Claudex Courts')).toBeInTheDocument()
    expect(within(g).getByText('0917 000 0000')).toBeInTheDocument()
    expect(within(g).getByRole('button', { name: 'Copy the GCash number' })).toBeInTheDocument()
    expect(within(g).getByRole('img', { name: 'QR code for GCash' })).toBeInTheDocument()
    expect(within(g).getByRole('button', { name: 'Show the GCash QR code full size' })).toBeInTheDocument()
    expect(within(g).getByRole('link', { name: 'Download QR' })).toBeInTheDocument()
    expect(within(g).getByRole('button', { name: 'How to save to Photos on iPhone' })).toBeInTheDocument()
    // The chosen card's button stays a pressed toggle reading "Selected".
    const pressed = within(g).getByRole('button', { pressed: true })
    expect(pressed).toHaveTextContent('Selected')
    expect(pressed).toHaveAttribute('aria-pressed', 'true')

    const b = card('BPI')
    expect(within(b).getByText('BPI')).toBeInTheDocument()
    expect(within(b).getByRole('button', { name: 'Pay with BPI' })).toBeInTheDocument()
    expect(within(b).queryByRole('button', { pressed: true })).not.toBeInTheDocument()
    expect(within(b).queryByText('1234-5678-90')).not.toBeInTheDocument()
    expect(within(b).queryByText('Claudex Bank Name')).not.toBeInTheDocument()
    expect(within(b).queryByRole('img')).not.toBeInTheDocument()
    expect(within(b).queryByRole('link', { name: 'Download QR' })).not.toBeInTheDocument()
  })

  it('follows selectedId when the parent changes it', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const ui = (id: string) => (
      <QueryClientProvider client={client}><PaymentAccountList selectedId={id} onSelect={vi.fn()} /></QueryClientProvider>
    )
    const { rerender } = render(ui('a1'))
    await screen.findByRole('list', { name: 'Payment accounts' })
    expect(within(card('GCash')).getByText('0917 000 0000')).toBeInTheDocument()
    rerender(ui('a2'))
    expect(within(card('BPI')).getByText('1234-5678-90')).toBeInTheDocument()
    expect(within(card('GCash')).queryByText('0917 000 0000')).not.toBeInTheDocument()
    expect(within(card('GCash')).getByRole('button', { name: 'Pay with GCash' })).toBeInTheDocument()
  })

  it('stays fully shown, with no "Pay with" buttons, when no onSelect is passed', async () => {
    renderList({})
    await screen.findByRole('list', { name: 'Payment accounts' })
    expect(screen.queryByRole('button', { name: /^Pay with / })).not.toBeInTheDocument()
    expect(within(card('GCash')).getByText('0917 000 0000')).toBeInTheDocument()
    expect(within(card('BPI')).getByText('1234-5678-90')).toBeInTheDocument()
  })
})
