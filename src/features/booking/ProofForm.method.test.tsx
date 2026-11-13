// T27.4: the "Paid with" select can be controlled (`method` / `onMethodChange`), and a venue with exactly one account
// preselects it.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPaymentAccounts, type PaymentAccount } from '../venue/api'
import { ProofForm } from './ProofForm'

vi.mock('../venue/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchPaymentAccounts: vi.fn() }))

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

const account = (id: string, label: string, position: number): PaymentAccount =>
  ({ id, label, account_name: '', account_number: '', qr_path: null, position })
const two = [account('a-1', 'GCash Business', 0), account('a-2', 'BPI', 1)]
const png = () => new File([new Uint8Array(100)], 'receipt.png', { type: 'image/png' })

function Harness({ onSubmit, onMethodChange }: { onSubmit: () => void; onMethodChange: (m: string) => void }) {
  const [method, setMethod] = useState('')
  return (
    <ProofForm total={900} currency="PHP" pending={false} error={null} onSubmit={onSubmit} method={method}
      onMethodChange={(m) => { onMethodChange(m); setMethod(m) }} />
  )
}

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.mocked(fetchPaymentAccounts).mockReset().mockResolvedValue(two)
})

describe('ProofForm controlled method (T27.4)', () => {
  it('shows the account the parent passes as method', async () => {
    wrap(<ProofForm total={900} currency="PHP" pending={false} error={null} onSubmit={vi.fn()} method="account:a-2" onMethodChange={vi.fn()} />)
    expect(await screen.findByLabelText('Paid with')).toHaveValue('account:a-2')
  })

  it('shows Choose… when the parent passes an empty method and there are 2 accounts', async () => {
    wrap(<ProofForm total={900} currency="PHP" pending={false} error={null} onSubmit={vi.fn()} method="" onMethodChange={vi.fn()} />)
    expect(await screen.findByLabelText('Paid with')).toHaveValue('')
  })

  it('reports a hand change through onMethodChange and follows the parent state', async () => {
    const onMethodChange = vi.fn()
    wrap(<Harness onSubmit={vi.fn()} onMethodChange={onMethodChange} />)
    const select = await screen.findByLabelText('Paid with')
    await userEvent.selectOptions(select, 'BPI')
    expect(onMethodChange).toHaveBeenCalledWith('account:a-2')
    expect(select).toHaveValue('account:a-2')
  })

  it('submits the account the parent chose', async () => {
    const onSubmit = vi.fn()
    wrap(<ProofForm total={900} currency="PHP" pending={false} error={null} onSubmit={onSubmit} method="account:a-1" onMethodChange={vi.fn()} />)
    await screen.findByLabelText('Paid with')
    const file = png()
    await userEvent.upload(screen.getByLabelText(/Receipt screenshot/), file)
    await userEvent.click(screen.getByRole('button', { name: 'Submit proof of payment' }))
    expect(onSubmit).toHaveBeenCalledWith({ accountId: 'a-1', amount: 900, referenceNumber: '', file })
  })

  it('preselects the only account (uncontrolled) and submits it without a choice', async () => {
    vi.mocked(fetchPaymentAccounts).mockResolvedValue([two[0]])
    const onSubmit = vi.fn()
    wrap(<ProofForm total={900} currency="PHP" pending={false} error={null} onSubmit={onSubmit} />)
    expect(await screen.findByLabelText('Paid with')).toHaveValue('account:a-1')
    const file = png()
    await userEvent.upload(screen.getByLabelText(/Receipt screenshot/), file)
    await userEvent.click(screen.getByRole('button', { name: 'Submit proof of payment' }))
    expect(onSubmit).toHaveBeenCalledWith({ accountId: 'a-1', amount: 900, referenceNumber: '', file })
  })

  it('preselects the only account when the parent passes an empty method', async () => {
    vi.mocked(fetchPaymentAccounts).mockResolvedValue([two[0]])
    wrap(<ProofForm total={900} currency="PHP" pending={false} error={null} onSubmit={vi.fn()} method="" onMethodChange={vi.fn()} />)
    expect(await screen.findByLabelText('Paid with')).toHaveValue('account:a-1')
  })

  it('preselects nothing with no accounts, and keeps the fixed method list', async () => {
    vi.mocked(fetchPaymentAccounts).mockResolvedValue([])
    wrap(<ProofForm total={900} currency="PHP" pending={false} error={null} onSubmit={vi.fn()} />)
    expect(await screen.findByLabelText('Paid with')).toHaveValue('')
  })
})
