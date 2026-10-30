// T11.28: by_method[].paid_with is read as paidWith (null when absent).
import { describe, expect, it } from 'vitest'
import { parseEarnings } from './earnings'

describe('parseEarnings paid_with', () => {
  it('reads paid_with per method entry, null when missing or null', () => {
    const e = parseEarnings({
      collected: {
        total: 1500, count: 3,
        by_method: [
          { method: 'account', paid_with: 'BPI Savings', amount: 900, count: 2 },
          { method: 'cash', paid_with: null, amount: 600, count: 1 },
          { method: 'paymongo', amount: 100, count: 1 },
        ],
      },
    })
    expect(e.collected.byMethod).toEqual([
      { method: 'account', paidWith: 'BPI Savings', amount: 900, count: 2 },
      { method: 'cash', paidWith: null, amount: 600, count: 1 },
      { method: 'paymongo', paidWith: null, amount: 100, count: 1 },
    ])
  })
})
