// T13.3: catalog reads filter on the current venue; admin writes take the venue from currentVenueId().
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'

const h = vi.hoisted(() => ({
  ops: [] as { table: string; op: string; payload?: unknown; eqs: [string, unknown][] }[],
}))

vi.mock('../auth/api', () => ({ currentAdminVenueId: vi.fn(async () => 'c0000000-0000-4000-8000-0000000000ff') }))
vi.mock('../../lib/supabase', () => {
  const builder = (table: string) => {
    const rec = { table, op: 'select', payload: undefined as unknown, eqs: [] as [string, unknown][] }
    h.ops.push(rec)
    const chain: Record<string, unknown> = {}
    for (const m of ['insert', 'update', 'upsert']) chain[m] = (payload: unknown) => { rec.op = m; rec.payload = payload; return chain }
    chain.eq = (c: string, v: unknown) => { rec.eqs.push([c, v]); return chain }
    for (const m of ['select', 'order', 'limit', 'in', 'gte']) chain[m] = () => chain
    chain.single = () => Promise.resolve({ data: { sport_order: [] }, error: null })
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
    return chain
  }
  return { supabase: { from: builder, rpc: () => Promise.resolve({ data: null, error: null }) } }
})

import {
  catalogKeys, createBlackout, fetchCourts, fetchOperatingHours, fetchUpcomingBlackouts, fetchVenueSettings,
  saveCourt, saveCourtRates, updateVenueSettings,
} from './api'
import type { TablesInsert } from '../../lib/database.types'

const VENUE_ID = 'b0000000-0000-4000-8000-0000000000b1'
const VENUE = { id: VENUE_ID, slug: 'bay-courts', status: 'active' as const }
const reads = (table: string) => h.ops.filter((o) => o.table === table && o.op === 'select')
const find = (table: string, op: string) => h.ops.find((o) => o.table === table && o.op === op)

beforeEach(() => {
  h.ops.length = 0
  setCurrentVenue(VENUE)
})

describe('catalog reads send the venue id (T13.3)', () => {
  it('fetchVenueSettings', async () => {
    await fetchVenueSettings()
    expect(reads('venue_settings')[0].eqs).toContainEqual(['venue_id', VENUE_ID])
  })

  it.each([true, false])('fetchCourts(%s) filters courts and the sport_order read', async (includeInactive) => {
    await fetchCourts(includeInactive)
    expect(reads('courts')[0].eqs).toContainEqual(['venue_id', VENUE_ID])
    expect(reads('venue_settings')[0].eqs).toContainEqual(['venue_id', VENUE_ID])
  })

  it('fetchOperatingHours', async () => {
    await fetchOperatingHours()
    expect(reads('operating_hours')[0].eqs).toContainEqual(['venue_id', VENUE_ID])
  })

  it('fetchUpcomingBlackouts', async () => {
    await fetchUpcomingBlackouts()
    expect(reads('blackouts')[0].eqs).toContainEqual(['venue_id', VENUE_ID])
  })
})

describe('catalogKeys include the venue (T13.3)', () => {
  it('every key starts with the current venue id', () => {
    const keys = [
      catalogKeys.settings(), catalogKeys.courts(true), catalogKeys.courts(false), catalogKeys.allCourts(),
      catalogKeys.court('c1'), catalogKeys.rates('c1'), catalogKeys.hours(), catalogKeys.blackouts(),
    ]
    for (const key of keys) expect(key[0]).toBe(VENUE_ID)
  })

  it('keeps the court id and includeInactive in the key', () => {
    expect(JSON.stringify(catalogKeys.court('c1'))).toContain('c1')
    expect(JSON.stringify(catalogKeys.rates('c2'))).toContain('c2')
    expect(catalogKeys.courts(true)).not.toEqual(catalogKeys.courts(false))
  })
})

describe('admin writes take the venue from currentVenueId() (T13.3)', () => {
  it('new court, rates, blackout and settings update all use the current venue', async () => {
    await saveCourt(null, { name: 'Court 9', sport: 'tennis', description: 'Hard', default_hourly_rate: 500, is_active: true, sort_order: 9 })
    expect(find('courts', 'insert')?.payload).toMatchObject({ venue_id: VENUE_ID })

    await saveCourtRates('c1', { upserts: [{ court_id: 'c1', day_of_week: 1, start_hour: 8, price: 600 }], deletes: [] })
    expect((find('court_rates', 'upsert')?.payload as { venue_id: string }[])[0].venue_id).toBe(VENUE_ID)

    await createBlackout({ court_id: 'c1', starts_at: '2030-01-01T00:00:00Z', ends_at: '2030-01-02T00:00:00Z', reason: 'x' } as TablesInsert<'blackouts'>)
    expect(find('blackouts', 'insert')?.payload).toMatchObject({ venue_id: VENUE_ID })

    await updateVenueSettings({ online_payments_enabled: false })
    expect(find('venue_settings', 'update')?.eqs).toContainEqual(['venue_id', VENUE_ID])
  })
})
