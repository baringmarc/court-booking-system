// T19.3: the selection bar names the promo(s) of the selected hours. The total is the server's slot prices.
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SelectionSummary } from './selection'
import { SelectionBar } from './SelectionBar'

// 2030-01-07 10:00-12:00 Manila (UTC+8).
const base: SelectionSummary = {
  courtId: 'A', start: '2030-01-07T02:00:00.000Z', end: '2030-01-07T04:00:00.000Z', slots: 2, total: 1000, promoLabels: [],
}

function renderBar(summary: SelectionSummary) {
  render(
    <SelectionBar summary={summary} courtName="Badminton 1" date="2030-01-07" timeZone="Asia/Manila" currency="PHP"
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
