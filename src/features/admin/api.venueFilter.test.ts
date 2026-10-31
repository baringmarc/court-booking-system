// T13.4: admin and account reads filter on the current venue; keys start with the venue id.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'

const h = vi.hoisted(() => ({
  ops: [] as { table: string; eqs: [string, unknown][] }[],
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
}))

vi.mock('../../lib/supabase', () => {
  const builder = (table: string) => {
    const rec = { table, eqs: [] as [string, unknown][] }
    h.ops.push(rec)
    const chain: Record<string, unknown> = {}
    chain.eq = (c: string, v: unknown) => { rec.eqs.push([c, v]); return chain }
    for (const m of ['select', 'order', 'limit', 'in', 'or', 'overlaps', 'gte', 'lt', 'range']) chain[m] = () => chain
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve)
    return chain
  }
  return {
    supabase: {
      from: builder,
      rpc: (name: string, args: Record<string, unknown>) => { h.rpcs.push({ name, args }); return Promise.resolve({ data: {}, error: null }) },
    },
  }
})

import { accountKeys } from '../account/hooks'
import { fetchMyBookings } from '../account/api'
import {
  adminKeys, fetchActiveMovedParts, fetchAdminBookings, fetchBookingsForExport, fetchEarnings, fetchPaymentsForExport,
  fetchProofQueueCount,
} from './api'
import { DEFAULT_FILTERS } from './bookingFilters'

const VENUE_ID = 'b0000000-0000-4000-8000-0000000000b1'
const reads = (table: string) => h.ops.filter((o) => o.table === table)
const filters = { ...DEFAULT_FILTERS, status: 'all' as const }

beforeEach(() => {
  h.ops.length = 0
  h.rpcs.length = 0
  setCurrentVenue({ id: VENUE_ID, slug: 'bay-courts', status: 'active' })
})

describe('admin reads filter on the current venue (T13.4)', () => {
  it('fetchAdminBookings', async () => {
    await fetchAdminBookings(filters, 'Asia/Manila')
    expect(reads('bookings')[0].eqs).toContainEqual(['venue_id', VENUE_ID])
  })

  it('fetchProofQueueCount', async () => {
    await fetchProofQueueCount()
    expect(reads('bookings')[0].eqs).toContainEqual(['venue_id', VENUE_ID])
    expect(reads('bookings')[0].eqs).toContainEqual(['status', 'payment_submitted'])
  })

  it('fetchBookingsForExport', async () => {
    await fetchBookingsForExport('2030-01-01T00:00:00Z', '2030-02-01T00:00:00Z')
    expect(reads('bookings')[0].eqs).toContainEqual(['venue_id', VENUE_ID])
  })

  it('fetchPaymentsForExport', async () => {
    await fetchPaymentsForExport('2030-01-01T00:00:00Z', '2030-02-01T00:00:00Z')
    expect(reads('payments')[0].eqs).toContainEqual(['venue_id', VENUE_ID])
  })

  it('fetchEarnings sends p_venue_id to get_earnings', async () => {
    await fetchEarnings('2030-01-01', '2030-01-31')
    expect(h.rpcs[0].name).toBe('get_earnings')
    expect(h.rpcs[0].args).toMatchObject({ p_from: '2030-01-01', p_to: '2030-01-31', p_venue_id: VENUE_ID })
  })

  it('fetchActiveMovedParts stays by parent id', async () => {
    await fetchActiveMovedParts('parent-1')
    expect(reads('bookings')[0].eqs).toContainEqual(['parent_booking_id', 'parent-1'])
  })

  it('fetchMyBookings also filters venue_id', async () => {
    await fetchMyBookings('u1')
    expect(reads('bookings')[0].eqs).toContainEqual(['user_id', 'u1'])
    expect(reads('bookings')[0].eqs).toContainEqual(['venue_id', VENUE_ID])
  })
})

describe('query keys start with the venue id (T13.4)', () => {
  it('adminKeys', () => {
    const keys = [
      adminKeys.bookings(filters), adminKeys.allBookings(), adminKeys.proofQueue(), adminKeys.earnings('2030-01-01', '2030-01-31'),
      adminKeys.allEarnings(), adminKeys.allMovedParts(), adminKeys.movedParts('b1'),
    ]
    for (const key of keys) expect(key[0]).toBe(VENUE_ID)
  })

  it('adminKeys keep their identifying parts and the all* prefixes match the specific keys', () => {
    expect(JSON.stringify(adminKeys.movedParts('b1'))).toContain('b1')
    expect(JSON.stringify(adminKeys.earnings('2030-01-01', '2030-01-31'))).toContain('2030-01-31')
    const all = adminKeys.allBookings()
    expect(adminKeys.bookings(filters).slice(0, all.length)).toEqual([...all])
    const allM = adminKeys.allMovedParts()
    expect(adminKeys.movedParts('b1').slice(0, allM.length)).toEqual([...allM])
    const allE = adminKeys.allEarnings()
    expect(adminKeys.earnings('a', 'b').slice(0, allE.length)).toEqual([...allE])
  })

  it('proofUrl is unchanged', () => {
    expect(adminKeys.proofUrl('p/1.png')).toEqual(['proof-url', 'p/1.png'])
  })

  it('accountKeys', () => {
    for (const key of [accountKeys.myBookings('u1'), accountKeys.claim('u1'), accountKeys.allMyBookings()]) expect(key[0]).toBe(VENUE_ID)
    expect(JSON.stringify(accountKeys.myBookings('u1'))).toContain('u1')
    const all = accountKeys.allMyBookings()
    expect(accountKeys.myBookings('u1').slice(0, all.length)).toEqual([...all])
  })

  it('keys differ between venues', () => {
    const a = adminKeys.allBookings()
    setCurrentVenue({ id: 'other', slug: 'other-venue', status: 'active' })
    expect(adminKeys.allBookings()).not.toEqual(a)
  })
})
