// T19.3: the selection bar names the promo(s) of the selected hours. The total is the server's slot prices.
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SelectionSummary } from './selection'
import { SelectionBar } from './SelectionBar'

// 2030-01-07 10:00-12:00 Manila (UTC+8).
const base: SelectionSummary = {
  courtId: 'A', start: '2030-01-07T02:00:00.000Z', end: '2030-01-07T04:00:00.000Z', slots: 2, total: 1000, promoLabels: [],
}

function renderBar(summary: SelectionSummary, fee: number | null = 0) {
  render(
    <SelectionBar summary={summary} courtName="Badminton 1" date="2030-01-07" timeZone="Asia/Manila" currency="PHP" fee={fee}
      onClear={vi.fn()} onContinue={vi.fn()} />,
  )
  return screen.getByRole('region', { name: 'Your selection' })
}

describe('SelectionBar promo (T19.3)', () => {
  it('shows "Promo: <label>" inside the selection region when the hours have a promo', () => {
    const region = renderBar({ ...base, promoLabels: ['Happy hour'] })
    expect(within(region).getByText('Promo: Happy hour')).toBeInTheDocument()
    expect(within(region).getByText('₱1,000')).toBeInTheDocument()
  })

  it('joins several labels with a comma and a space', () => {
    const region = renderBar({ ...base, promoLabels: ['Happy hour', 'Early bird'] })
    expect(within(region).getByText('Promo: Happy hour, Early bird')).toBeInTheDocument()
  })

  it('shows nothing about a promo when there is none', () => {
    const region = renderBar(base)
    expect(region).not.toHaveTextContent(/promo/i)
  })
})

// T27.1: the bar shows the payable total (court + booking fee) from the start.
describe('SelectionBar fee-inclusive total (T27.1)', () => {
  const court800: SelectionSummary = { ...base, total: 800 }

  it('fee 10: shows the breakdown "Court ₱800 + booking fee ₱10 = ₱810" and ₱810 as the total', () => {
    const region = renderBar(court800, 10)
    expect(region).toHaveTextContent('Court ₱800 + booking fee ₱10 = ₱810')
    expect(within(region).getByText('₱810')).toBeInTheDocument()
  })

  it('fee 0: only the court total, no breakdown and no booking fee text', () => {
    const region = renderBar(court800, 0)
    expect(within(region).getByText('₱800')).toBeInTheDocument()
    expect(region).not.toHaveTextContent(/booking fee/i)
    expect(region).not.toHaveTextContent('Court ₱800')
  })

  it('fee null (loading or failed): court total plus "+ booking fee" with no number, never a wrong total', () => {
    const region = renderBar(court800, null)
    expect(region).toHaveTextContent(/₱800\s*\+ booking fee/)
    expect(region).not.toHaveTextContent(/₱810/)
    expect(region).not.toHaveTextContent(/₱10(?!\d)/)
    expect(region).not.toHaveTextContent('=')
  })

  it('a promo-priced selection keeps its label and totals court + fee (₱500 + ₱10 = ₱510)', () => {
    const region = renderBar({ ...base, total: 500, promoLabels: ['Happy hour'] }, 10)
    expect(within(region).getByText('Promo: Happy hour')).toBeInTheDocument()
    expect(region).toHaveTextContent('Court ₱500 + booking fee ₱10 = ₱510')
    expect(within(region).getByText('₱510')).toBeInTheDocument()
  })
})
