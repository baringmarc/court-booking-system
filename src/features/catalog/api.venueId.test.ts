// T12.10: catalog admin writes name their venue and settings updates filter on venue_id.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tables, TablesInsert } from '../../lib/database.types'

const h = vi.hoisted(() => ({
  VENUE: 'a0000000-0000-0000-0000-00000000000a',
  ops: [] as { table: string; op: string; payload?: unknown; eqs: [string, unknown][] }[],
}))

vi.mock('../../lib/currentVenue', () => ({ currentVenueId: () => h.VENUE }))
vi.mock('../../lib/supabase', () => {
  const builder = (table: string) => {
    const rec = { table, op: 'select', payload: undefined as unknown, eqs: [] as [string, unknown][] }
    h.ops.push(rec)
    const chain: Record<string, unknown> = {}
    for (const m of ['insert', 'update', 'upsert']) chain[m] = (payload: unknown) => { rec.op = m; rec.payload = payload; return chain }
    chain.delete = () => { rec.op = 'delete'; return chain }
    chain.eq = (c: string, v: unknown) => { rec.eqs.push([c, v]); return chain }
    for (const m of ['select', 'order', 'limit', 'in', 'gte']) chain[m] = () => chain
    chain.single = () => Promise.resolve({ data: { id: 'x' }, error: null })
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
    return chain
  }
  return { supabase: { from: builder, rpc: () => Promise.resolve({ data: null, error: null }) } }
})

const { VENUE } = h
import { createBlackout, saveCourt, saveCourtRates, updateVenueSettings } from './api'

const find = (table: string, op: string) => h.ops.find((o) => o.table === table && o.op === op)

beforeEach(() => {
  h.ops.length = 0
})

describe('catalog admin writes pass venue_id (T12.10)', () => {
  it('a new court carries the venue id', async () => {
    await saveCourt(null, { name: 'Court 9', sport: 'tennis', description: 'Hard court', default_hourly_rate: 500, is_active: true, sort_order: 9 })
    expect(find('courts', 'insert')?.payload).toMatchObject({ venue_id: VENUE, name: 'Court 9' })
  })

  it('court rate upserts carry the venue id on every row', async () => {
    const rates = [
      { court_id: 'c1', day_of_week: 1, start_hour: 8, price: 600 },
      { court_id: 'c1', day_of_week: 2, start_hour: 9, price: 700 },
    ] satisfies Omit<Tables<'court_rates'>, 'venue_id'>[]
    await saveCourtRates('c1', { upserts: rates, deletes: [] })
    const rows = find('court_rates', 'upsert')?.payload as { venue_id: string; day_of_week: number }[]
    expect(rows.map((r) => r.venue_id)).toEqual([VENUE, VENUE])
    expect(rows.map((r) => r.day_of_week)).toEqual([1, 2])
  })

  it('a new blackout carries the venue id', async () => {
    const input = { court_id: 'c1', starts_at: '2030-01-01T00:00:00Z', ends_at: '2030-01-02T00:00:00Z', reason: 'Resurfacing' } as TablesInsert<'blackouts'>
    await createBlackout(input)
    expect(find('blackouts', 'insert')?.payload).toMatchObject({ venue_id: VENUE, reason: 'Resurfacing' })
  })

  it('venue settings update filters on venue_id, not on the constant id', async () => {
    await updateVenueSettings({ online_payments_enabled: false })
    const update = find('venue_settings', 'update')!
    expect(update.payload).toMatchObject({ online_payments_enabled: false })
    expect(update.eqs).toContainEqual(['venue_id', VENUE])
    expect(update.eqs.map(([c]) => c)).not.toContain('id')
  })
})
