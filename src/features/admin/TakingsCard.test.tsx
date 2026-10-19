import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { refundsDueSummary, takingsByMethod } from './dashboard'
import { TakingsCard } from './TakingsCard'

describe('TakingsCard', () => {
  it('breaks the takings down by method, PayMongo included', () => {
    render(<TakingsCard currency="PHP" refundsDue={null}
      takings={takingsByMethod([{ method: 'cash', amount: 350 }, { method: 'paymongo', amount: 900 }, { method: 'gcash', amount: 450 }])} />)
    expect(screen.getByText('₱1,700')).toBeInTheDocument()
    const rows = within(screen.getByRole('list', { name: 'Takings by method' })).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual(['Cash₱350', 'GCash₱450', 'PayMongo₱900'])
  })

  it('shows online money that was received but not accepted apart from the total', () => {
    render(<TakingsCard currency="PHP" takings={takingsByMethod([{ method: 'paymongo', amount: 900 }])} refundsDue={refundsDueSummary([450])} />)
    expect(screen.getByText('₱900', { selector: '.big-number' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Also received online but not accepted: ₱450 (1 payment). Not in the total; refund outside the app.',
    )
  })

  it('shows refunds due even when nothing was taken', () => {
    render(<TakingsCard currency="PHP" takings={takingsByMethod([])} refundsDue={refundsDueSummary([450, 600])} />)
    expect(screen.getByText('Nothing taken yet today.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('₱1,050 (2 payments)')
  })

  it('shows no refund line when there is nothing to refund', () => {
    render(<TakingsCard currency="PHP" takings={takingsByMethod([{ method: 'cash', amount: 350 }])} refundsDue={refundsDueSummary([])} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says so, with a retry, when refunds due could not be loaded', async () => {
    const onRetry = vi.fn()
    render(<TakingsCard currency="PHP" takings={takingsByMethod([{ method: 'cash', amount: 350 }])} refundsDue={null}
      refundsError onRetryRefunds={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't check for online payments to refund.")
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
