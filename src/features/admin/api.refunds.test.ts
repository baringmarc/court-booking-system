// T30.6: refund reads and writes in the admin api: update_refund, the owed count, and the refunds on each booking.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'

const h = vi.hoisted(() => ({
  ops: [] as { table: string; selects: string[]; eqs: [string, unknown][]; head: boolean }[],
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  rows: [] as unknown[],
  count: 0,
  rpcError: null as { message: string; code?: string; hint?: string } | null,
}))

vi.mock('../../lib/supabase', () => {
  const builder = (table: string) => {
    const rec = { table, selects: [] as string[], eqs: [] as [string, unknown][], head: false }
    h.ops.push(rec)
    const chain: Record<string, unknown> = {}
    chain.select = (columns: string, opts?: { head?: boolean }) => { rec.selects.push(columns); rec.head = !!opts?.head; return chain }
    chain.eq = (c: string, v: unknown) => { rec.eqs.push([c, v]); return chain }
    for (const m of ['order', 'limit', 'in', 'or', 'overlaps', 'gte', 'lt', 'range', 'not']) chain[m] = () => chain
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: rec.head ? null : h.rows, error: null, count: h.count }).then(resolve)
    return chain
  }
  return {
    supabase: {
      from: builder,
      rpc: (name: string, args: Record<string, unknown>) => {
        h.rpcs.push({ name, args })
        return Promise.resolve(h.rpcError ? { data: null, error: h.rpcError } : { data: null, error: null })
      },
    },
  }
})

import { adminKeys, fetchAdminBookings, fetchRefundsOwedCount, updateRefund } from './api'
import { DEFAULT_FILTERS } from './bookingFilters'

const VENUE_ID = 'b0000000-0000-4000-8000-0000000000b1'

beforeEach(() => {
  h.ops.length = 0
  h.rpcs.length = 0
  h.rows = []
  h.count = 0
  h.rpcError = null
  setCurrentVenue({ id: VENUE_ID, slug: 'bay-courts', status: 'active' })
})

describe('updateRefund (T30.6)', () => {
  it('settles with every field, mapped to the update_refund arguments', async () => {
    await expect(updateRefund({
      refundId: 'r1', status: 'settled', amount: 450.5, method: 'gcash', settledOn: '2030-01-07', note: 'Sent by GCash',
    })).resolves.toBeUndefined()
    expect(h.rpcs).toHaveLength(1)
    expect(h.rpcs[0].name).toBe('update_refund')
    expect(h.rpcs[0].args).toEqual({
      p_refund_id: 'r1', p_status: 'settled', p_amount: 450.5, p_method: 'gcash', p_settled_on: '2030-01-07', p_note: 'Sent by GCash',
    })
  })

  it('sends the reason for not refunded, and leaves the other fields out', async () => {
    await updateRefund({ refundId: 'r1', status: 'not_refunded', reason: 'Court was flooded' })
    expect(h.rpcs[0].name).toBe('update_refund')
    expect(h.rpcs[0].args).toMatchObject({ p_refund_id: 'r1', p_status: 'not_refunded', p_reason: 'Court was flooded' })
    for (const key of ['p_amount', 'p_method', 'p_settled_on', 'p_note']) expect(h.rpcs[0].args[key]).toBeUndefined()
  })

  it('reopens with only the id and the status', async () => {
    await updateRefund({ refundId: 'r1', status: 'owed' })
    expect(h.rpcs[0].args).toEqual({ p_refund_id: 'r1', p_status: 'owed' })
  })

  it('sends an emptied note as an empty string, not as undefined', async () => {
    await updateRefund({ refundId: 'r1', status: 'settled', amount: 900, method: 'cash', settledOn: '2030-01-07', note: '' })
    expect(h.rpcs[0].args.p_note).toBe('')
  })

  it("throws the database error with its hint, so the card can show the server's text", async () => {
    h.rpcError = { message: 'Choose how the refund was made.', code: 'P0001', hint: 'missing_method' }
    await expect(updateRefund({ refundId: 'r1', status: 'settled', amount: 900, settledOn: '2030-01-07' })).rejects.toMatchObject({
      message: 'Choose how the refund was made.', hint: 'missing_method',
    })
  })
})

describe('fetchRefundsOwedCount (T30.6)', () => {
  it("counts the current venue's refunds that are owed", async () => {
    h.count = 4
    await expect(fetchRefundsOwedCount()).resolves.toBe(4)
    const op = h.ops.find((o) => o.table === 'refunds')
    expect(op).toBeDefined()
    expect(op!.eqs).toContainEqual(['venue_id', VENUE_ID])
    expect(op!.eqs).toContainEqual(['status', 'owed'])
  })

  it('reads none as 0', async () => {
    h.count = 0
    await expect(fetchRefundsOwedCount()).resolves.toBe(0)
  })

  it('has its own query key under the venue, so a refund update can refresh it', () => {
    expect(adminKeys.refundsOwed()[0]).toBe(VENUE_ID)
    expect(adminKeys.refundsOwed()).not.toEqual(adminKeys.proofQueue())
  })
})

describe('fetchAdminBookings refunds (T30.6)', () => {
  const row = (refunds: unknown) => ({
    id: 'b1', reference_code: 'CB-7KQ2XD', court_id: 'c1', during: '["2030-01-06 23:00:00+00","2030-01-07 00:00:00+00")', status: 'cancelled',
    source: 'online', total_amount: '900.00', booking_fee: '0.00', amount_due: '900.00', expires_at: null, rejection_count: 0,
    guest_name: 'Gina Guest', guest_email: null, guest_phone: null, created_at: '2030-01-06T15:00:00+00:00',
    cancelled_at: '2030-01-06T16:00:00+00:00', cancel_reason: 'Rain', cancelled_by_venue: true, parent_booking_id: null,
    courts: { name: 'Badminton 1', sport: 'badminton' }, payments: [], refunds,
  })
  const filters = { ...DEFAULT_FILTERS, status: 'all' as const }

  it('asks for the refunds with each booking', async () => {
    await fetchAdminBookings(filters, 'Asia/Manila')
    expect(h.ops.find((o) => o.table === 'bookings')!.selects.join(' ')).toMatch(/\brefunds\b/)
  })

  it('carries each refund with its amount as a number', async () => {
    h.rows = [row([{
      id: 'r1', payment_id: 'p1', amount: '450.50', status: 'settled', method: 'gcash', settled_on: '2030-01-07',
      reason: null, note: 'Sent', updated_at: '2030-01-07T03:00:00+00:00',
    }])]
    const { bookings } = await fetchAdminBookings(filters, 'Asia/Manila')
    expect(bookings[0].refunds).toEqual([{
      id: 'r1', payment_id: 'p1', amount: 450.5, status: 'settled', method: 'gcash', settled_on: '2030-01-07',
      reason: null, note: 'Sent', updated_at: '2030-01-07T03:00:00+00:00',
    }])
  })

  it('gives an empty list for a booking without refunds', async () => {
    h.rows = [row([])]
    const { bookings } = await fetchAdminBookings(filters, 'Asia/Manila')
    expect(bookings[0].refunds).toEqual([])
  })
})
