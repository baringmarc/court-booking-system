// T14.11: the venue statement api names the page's venue and returns the RPC's JSON as is.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  VENUE: 'a0000000-0000-0000-0000-00000000000a',
  calls: [] as { fn: string; args: unknown }[],
  result: { data: null as unknown, error: null as { message: string; code?: string } | null },
}))

vi.mock('../../lib/currentVenue', () => ({ currentVenueId: () => h.VENUE }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      h.calls.push({ fn, args })
      return Promise.resolve(h.result)
    },
  },
}))

import { fetchStatement, type VenueStatement } from './api'

const statement: VenueStatement = {
  month: '2026-10-01',
  fee_count: 2,
  fee_total: 20,
  adjustment_total: -10,
  total: 10,
  by_method: [{ method: 'account', paid_with: 'BPI', count: 2, fee_total: 20 }],
  lines: [{ charge_id: 'c1', booking_id: 'b1', reference_code: 'CB-AAAAAA', kind: 'booking_fee', amount: 10, charged_at: '2026-10-02T01:00:00+00:00' }],
  invoices: [{ invoice_id: 'i1', billing_month: '2026-10-01', status: 'draft', total: 10, sent_at: null, paid_at: null }],
}

describe('venue statement api', () => {
  beforeEach(() => {
    h.calls.length = 0
    h.result = { data: null, error: null }
  })

  it('fetchStatement calls venue_statement with the current venue and returns the statement', async () => {
    h.result = { data: statement, error: null }
    await expect(fetchStatement()).resolves.toEqual(statement)
    expect(h.calls).toEqual([{ fn: 'venue_statement', args: { p_venue_id: h.VENUE } }])
  })

  it('fetchStatement throws the database error message', async () => {
    h.result = { data: null, error: { message: 'Only staff of this venue can do this.', code: 'P0001' } }
    await expect(fetchStatement()).rejects.toThrow('Only staff of this venue can do this.')
  })
})
