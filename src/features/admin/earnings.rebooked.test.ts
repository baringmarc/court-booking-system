// T30.4: get_earnings' "rebooked" count (bookings made with Same time next week, SPEC §6 get_earnings).
import { describe, expect, it } from 'vitest'
import { parseEarnings } from './earnings'

describe('parseEarnings rebooked', () => {
  it('reads rebooked.count from the RPC JSON', () => {
    expect(parseEarnings({ rebooked: { count: 3 } }).rebooked).toEqual({ count: 3 })
  })

  it('reads a count of 0', () => {
    expect(parseEarnings({ rebooked: { count: 0 } }).rebooked).toEqual({ count: 0 })
  })

  it('reads a missing rebooked as { count: 0 }', () => {
    expect(parseEarnings({ from: '2026-10-19', to: '2026-10-25' }).rebooked).toEqual({ count: 0 })
    expect(parseEarnings({ rebooked: {} }).rebooked).toEqual({ count: 0 })
  })
})
