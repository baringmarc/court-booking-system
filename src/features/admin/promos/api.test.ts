// T19.2: promo reads and writes. Reads name the venue and fold the court links into court_ids; writes go through the RPCs with
// the p_* argument names; RPC errors keep their hint.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../lib/queryClient'

const h = vi.hoisted(() => ({
  VENUE: 'a0000000-0000-0000-0000-00000000000a',
  reads: [] as { table: string; select?: string; eqs: [string, unknown][]; orders: string[] }[],
  rpcs: [] as { name: string; args: unknown }[],
  rows: [] as unknown[],
  rpcResult: { data: 'new-promo-id' as unknown, error: null as null | { message: string; code: string; hint: string } },
}))

vi.mock('../../../lib/currentVenue', () => ({ currentVenueId: () => h.VENUE }))
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rec = { table, select: undefined as string | undefined, eqs: [] as [string, unknown][], orders: [] as string[] }
      h.reads.push(rec)
      const chain: Record<string, unknown> = {}
      chain.select = (cols: string) => { rec.select = cols; return chain }
      chain.eq = (c: string, v: unknown) => { rec.eqs.push([c, v]); return chain }
      chain.order = (c: string) => { rec.orders.push(c); return chain }
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: h.rows, error: null }).then(resolve)
      return chain
    },
    rpc: (name: string, args: unknown) => { h.rpcs.push({ name, args }); return Promise.resolve(h.rpcResult) },
  },
}))

import { deletePromo, fetchPromos, promoKeys, savePromo, type PromoInput } from './api'

const input: PromoInput = {
  id: null, label: 'Weekend promo', starts_on: '2030-02-01', ends_on: '2030-02-28', court_ids: ['c1', 'c2'],
  days: [0, 6], start_hour: 18, end_hour: 21, price: 500, is_active: true,
}

beforeEach(() => {
  h.reads.length = 0
  h.rpcs.length = 0
  h.rows = []
  h.rpcResult = { data: 'new-promo-id', error: null }
})

describe('promo api (T19.2)', () => {
  it('keys the list by the current venue', () => {
    expect(promoKeys.all()).toEqual([h.VENUE, 'admin-promos'])
  })

  it('fetchPromos reads court_promos for the current venue with the court links embedded, ordered by start date then label', async () => {
    await fetchPromos()
    const read = h.reads.find((r) => r.table === 'court_promos')!
    expect(read).toBeDefined()
    expect(read.eqs).toContainEqual(['venue_id', h.VENUE])
    expect(read.select).toMatch(/court_promo_courts\s*\(\s*court_id\s*\)/)
    expect(read.orders).toEqual(['starts_on', 'label'])
  })

  it('fetchPromos maps the embedded links to court_ids and drops the embed', async () => {
    h.rows = [{
      id: 'p1', venue_id: h.VENUE, label: 'Weekend', starts_on: '2030-02-01', ends_on: '2030-02-28', days_of_week: [0, 6],
      start_hour: 18, end_hour: 21, price: 500, is_active: true, created_at: '2030-01-01T00:00:00Z',
      court_promo_courts: [{ court_id: 'c1' }, { court_id: 'c2' }],
    }, {
      id: 'p2', venue_id: h.VENUE, label: 'Lunch', starts_on: '2030-03-01', ends_on: '2030-03-02', days_of_week: [1],
      start_hour: 12, end_hour: 13, price: 300, is_active: false, created_at: '2030-01-01T00:00:00Z',
      court_promo_courts: [],
    }]
    const promos = await fetchPromos()
    expect(promos).toHaveLength(2)
    expect(promos[0]).toMatchObject({
      id: 'p1', label: 'Weekend', starts_on: '2030-02-01', ends_on: '2030-02-28', days_of_week: [0, 6],
      start_hour: 18, end_hour: 21, price: 500, is_active: true, court_ids: ['c1', 'c2'],
    })
    expect(promos[0]).not.toHaveProperty('court_promo_courts')
    expect(promos[1].court_ids).toEqual([])
    expect(promos[1].is_active).toBe(false)
  })

  it('savePromo calls save_court_promo with the p_* arguments (null id on create) and returns the new id', async () => {
    await expect(savePromo(input)).resolves.toBe('new-promo-id')
    expect(h.rpcs).toEqual([{
      name: 'save_court_promo',
      args: {
        p_id: null, p_label: 'Weekend promo', p_starts_on: '2030-02-01', p_ends_on: '2030-02-28', p_court_ids: ['c1', 'c2'],
        p_days: [0, 6], p_start_hour: 18, p_end_hour: 21, p_price: 500, p_is_active: true,
      },
    }])
  })

  it('savePromo passes the promo id when editing', async () => {
    await savePromo({ ...input, id: 'p1', is_active: false })
    expect(h.rpcs[0].args).toMatchObject({ p_id: 'p1', p_is_active: false })
  })

  it('savePromo throws an ApiError that keeps the hint and the readable message', async () => {
    h.rpcResult = { data: null, error: { message: 'This promo overlaps "Happy hour" on the same court, day and hour.', code: 'P0001', hint: 'promo_overlap' } }
    const error = await savePromo(input).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).hint).toBe('promo_overlap')
    expect((error as ApiError).message).toBe('This promo overlaps "Happy hour" on the same court, day and hour.')
  })

  it('deletePromo calls delete_court_promo with p_id', async () => {
    h.rpcResult = { data: null, error: null }
    await deletePromo('p1')
    expect(h.rpcs).toEqual([{ name: 'delete_court_promo', args: { p_id: 'p1' } }])
  })

  it('deletePromo surfaces not_found as an ApiError with the hint', async () => {
    h.rpcResult = { data: null, error: { message: 'Promo not found.', code: 'P0001', hint: 'not_found' } }
    const error = await deletePromo('gone').catch((e: unknown) => e)
    expect((error as ApiError).hint).toBe('not_found')
  })
})
