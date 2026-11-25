// T19.3: the selection bar names the promo(s) of the selected hours. The total is the server's slot prices.
// T33.3: one run renders as before; two or more runs list each court and time with a Remove button.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { formatDateLabel } from '../../lib/time'
import type { RunSummary, SelectionSummary } from './selection'
import { SelectionBar } from './SelectionBar'

const NAMES: Record<string, string> = { A: 'Badminton 1', B: 'Badminton 2' }

// 2030-01-07 10:00-12:00 Manila (UTC+8).
const run10: RunSummary = { courtId: 'A', start: '2030-01-07T02:00:00.000Z', end: '2030-01-07T04:00:00.000Z', slots: 2, total: 1000, promoLabels: [] }
const oneRun = (overrides: Partial<RunSummary> = {}): SelectionSummary => {
  const run = { ...run10, ...overrides }
  return { runs: [run], courtCount: 1, total: run.total, promoLabels: run.promoLabels }
}
const base = oneRun()

function renderBar(summary: SelectionSummary, fee: number | null = 0, handlers: { onRemoveRun?: (run: RunSummary) => void; onClear?: () => void; onContinue?: () => void } = {}) {
  render(
    <SelectionBar summary={summary} courtName={(id) => NAMES[id] ?? id} date="2030-01-07" timeZone="Asia/Manila" currency="PHP" fee={fee}
      onRemoveRun={handlers.onRemoveRun ?? vi.fn()} onClear={handlers.onClear ?? vi.fn()} onContinue={handlers.onContinue ?? vi.fn()} />,
  )
  return screen.getByRole('region', { name: 'Your selection' })
}

describe('SelectionBar promo (T19.3)', () => {
  it('shows "Promo: <label>" inside the selection region when the hours have a promo', () => {
    const region = renderBar(oneRun({ promoLabels: ['Happy hour'] }))
    expect(within(region).getByText('Promo: Happy hour')).toBeInTheDocument()
    expect(within(region).getByText('₱1,000')).toBeInTheDocument()
  })

  it('joins several labels with a comma and a space', () => {
    const region = renderBar(oneRun({ promoLabels: ['Happy hour', 'Early bird'] }))
    expect(within(region).getByText('Promo: Happy hour, Early bird')).toBeInTheDocument()
  })

  it('shows nothing about a promo when there is none', () => {
    const region = renderBar(base)
    expect(region).not.toHaveTextContent(/promo/i)
  })
})

// T27.1: the bar shows the payable total (court + booking fee) from the start.
describe('SelectionBar fee-inclusive total (T27.1)', () => {
  const court800: SelectionSummary = oneRun({ total: 800 })

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
    const region = renderBar(oneRun({ total: 500, promoLabels: ['Happy hour'] }), 10)
    expect(within(region).getByText('Promo: Happy hour')).toBeInTheDocument()
    expect(region).toHaveTextContent('Court ₱500 + booking fee ₱10 = ₱510')
    expect(within(region).getByText('₱510')).toBeInTheDocument()
  })
})

describe('SelectionBar with one run (T33.3: unchanged)', () => {
  it('shows the court as the strong line, then "{date} · 10 AM–12 PM · 2 hours", and no run list', () => {
    const region = renderBar(base)
    expect(region.querySelector('strong')).toHaveTextContent(/^Badminton 1$/)
    expect(region).toHaveTextContent(`${formatDateLabel('2030-01-07', 'Asia/Manila')} · 10 AM–12 PM · 2 hours`)
    expect(screen.queryByRole('list', { name: 'Selected times' })).not.toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
  })

  it('says "1 hour" for a single hour, in the early morning (7 AM Manila is the day before in UTC)', () => {
    const region = renderBar(oneRun({ start: '2030-01-06T23:00:00.000Z', end: '2030-01-07T00:00:00.000Z', slots: 1, total: 350 }))
    expect(region).toHaveTextContent('7 AM–8 AM · 1 hour')
    expect(region).not.toHaveTextContent('1 hours')
  })

  it('Clear and Continue call their handlers', async () => {
    const onClear = vi.fn()
    const onContinue = vi.fn()
    const region = renderBar(base, 0, { onClear, onContinue })
    await userEvent.click(within(region).getByRole('button', { name: 'Clear' }))
    await userEvent.click(within(region).getByRole('button', { name: 'Continue' }))
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})

// 2030-01-07 Manila: 3-4 PM = 07:00-08:00Z, 5-7 PM = 09:00-11:00Z, 8-9 PM = 12:00-13:00Z.
const r1: RunSummary = { courtId: 'A', start: '2030-01-07T07:00:00.000Z', end: '2030-01-07T08:00:00.000Z', slots: 1, total: 350, promoLabels: [] }
const r2: RunSummary = { courtId: 'B', start: '2030-01-07T09:00:00.000Z', end: '2030-01-07T11:00:00.000Z', slots: 2, total: 800, promoLabels: [] }
const r3: RunSummary = { courtId: 'A', start: '2030-01-07T12:00:00.000Z', end: '2030-01-07T13:00:00.000Z', slots: 1, total: 450, promoLabels: [] }
const multi = (runs: RunSummary[], courtCount: number): SelectionSummary => ({
  runs, courtCount, total: runs.reduce((sum, r) => sum + r.total, 0), promoLabels: [...new Set(runs.flatMap((r) => r.promoLabels))],
})

describe('SelectionBar with several runs (T33.3)', () => {
  it('two runs on two courts: "2 times · 2 courts", the date with the total hours, and one item per run', () => {
    const region = renderBar(multi([r1, r2], 2))
    expect(region.querySelector('strong')).toHaveTextContent(/^2 times · 2 courts$/)
    expect(region).toHaveTextContent(`${formatDateLabel('2030-01-07', 'Asia/Manila')} · 3 hours`)
    const items = within(within(region).getByRole('list', { name: 'Selected times' })).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Badminton 1, 3 PM–4 PM')
    expect(items[1]).toHaveTextContent('Badminton 2, 5 PM–7 PM')
    expect(within(region).getByRole('button', { name: 'Remove Badminton 1, 3 PM–4 PM' })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Remove Badminton 2, 5 PM–7 PM' })).toBeInTheDocument()
  })

  it('two runs on one court: "2 times · 1 court" (singular)', () => {
    const region = renderBar(multi([r1, r3], 1))
    expect(region.querySelector('strong')).toHaveTextContent(/^2 times · 1 court$/)
    const items = within(region).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Badminton 1, 3 PM–4 PM')
    expect(items[1]).toHaveTextContent('Badminton 1, 8 PM–9 PM')
  })

  it('three runs on two courts: "3 times · 2 courts", 4 hours', () => {
    const region = renderBar(multi([r1, r2, r3], 2))
    expect(region.querySelector('strong')).toHaveTextContent(/^3 times · 2 courts$/)
    expect(region).toHaveTextContent('· 4 hours')
    expect(within(region).getAllByRole('listitem')).toHaveLength(3)
  })

  it('the Remove button of a run calls onRemoveRun with that run only', async () => {
    const onRemoveRun = vi.fn()
    const region = renderBar(multi([r1, r2], 2), 0, { onRemoveRun })
    await userEvent.click(within(region).getByRole('button', { name: 'Remove Badminton 2, 5 PM–7 PM' }))
    expect(onRemoveRun).toHaveBeenCalledTimes(1)
    expect(onRemoveRun).toHaveBeenCalledWith(r2)
  })

  it('total with fee 0 is the sum of the runs, with no breakdown', () => {
    const region = renderBar(multi([r1, r2], 2), 0)
    expect(region.querySelector('.selection-total')).toHaveTextContent('₱1,150')
    expect(region).not.toHaveTextContent(/booking fee/i)
  })

  it('charges ONE booking fee: "Court ₱1,150 + booking fee ₱10 = ₱1,160" and ₱1,160 as the total', () => {
    const region = renderBar(multi([r1, r2], 2), 10)
    expect(region).toHaveTextContent('Court ₱1,150 + booking fee ₱10 = ₱1,160')
    expect(region.querySelector('.selection-total strong')).toHaveTextContent(/^₱1,160$/)
    expect(region.textContent?.match(/booking fee/g)).toHaveLength(1)
  })

  it('fee null: the court sum plus "+ booking fee" with no number, never a guessed total', () => {
    const region = renderBar(multi([r1, r2], 2), null)
    expect(region.querySelector('.selection-total')).toHaveTextContent(/₱1,150\s*\+ booking fee/)
    expect(region).not.toHaveTextContent(/₱1,160/)
    expect(region).not.toHaveTextContent('=')
  })

  it('shows one promo line over the labels of all runs', () => {
    const region = renderBar(multi([{ ...r1, promoLabels: ['Happy hour'] }, { ...r2, promoLabels: ['Happy hour', 'Early bird'] }], 2))
    expect(within(region).getByText('Promo: Happy hour, Early bird')).toBeInTheDocument()
  })

  it('has no promo text when no run has a promo', () => {
    expect(renderBar(multi([r1, r2], 2))).not.toHaveTextContent(/promo/i)
  })

  it('keeps Clear and Continue', async () => {
    const onClear = vi.fn()
    const onContinue = vi.fn()
    const region = renderBar(multi([r1, r2], 2), 0, { onClear, onContinue })
    await userEvent.click(within(region).getByRole('button', { name: 'Clear' }))
    await userEvent.click(within(region).getByRole('button', { name: 'Continue' }))
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})
