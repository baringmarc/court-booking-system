// T30.6: get_earnings' refunded and net parts (SPEC §6 get_earnings), read into numbers like Collected.
import { describe, expect, it } from 'vitest'
import { parseEarnings } from './earnings'

describe('parseEarnings refunded and net (T30.6)', () => {
  it('reads refunded with its methods and the previous period', () => {
    const e = parseEarnings({
      refunded: {
        total: 200, count: 2,
        by_method: [{ method: 'gcash', amount: 150, count: 1 }, { method: 'cash', amount: '50.00', count: 1 }],
        previous: { from: '2026-10-24', to: '2026-10-24', total: '100.50', count: 1, by_method: [{ method: 'maya', amount: 100.5, count: 1 }] },
      },
      net: { total: 1300, previous: { total: '900.00' } },
    })
    expect(e.refunded).toEqual({
      total: 200, count: 2,
      byMethod: [{ method: 'gcash', paidWith: null, amount: 150, count: 1 }, { method: 'cash', paidWith: null, amount: 50, count: 1 }],
      previous: {
        from: '2026-10-24', to: '2026-10-24', total: 100.5, count: 1,
        byMethod: [{ method: 'maya', paidWith: null, amount: 100.5, count: 1 }],
      },
    })
    expect(e.net).toEqual({ total: 1300, previous: { total: 900 } })
  })

  it('reads missing parts as zero and empty', () => {
    const e = parseEarnings({ from: '2026-10-19', to: '2026-10-25' })
    expect(e.refunded).toEqual({ total: 0, count: 0, byMethod: [], previous: { from: '', to: '', total: 0, count: 0, byMethod: [] } })
    expect(e.net).toEqual({ total: 0, previous: { total: 0 } })
  })

  it('reads a refunded without a previous period, and a net without one', () => {
    const e = parseEarnings({ refunded: { total: 50, count: 1, by_method: [] }, net: { total: 10 } })
    expect(e.refunded.total).toBe(50)
    expect(e.refunded.previous).toEqual({ from: '', to: '', total: 0, count: 0, byMethod: [] })
    expect(e.net).toEqual({ total: 10, previous: { total: 0 } })
  })

  it('keeps refundsDue as the count and total of owed refunds', () => {
    expect(parseEarnings({ refunds_due: { count: 2, total: 700 } }).refundsDue).toEqual({ count: 2, total: 700 })
  })
})
