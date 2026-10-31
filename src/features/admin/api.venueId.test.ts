// T12.10: admin writes name their venue (currentVenueId) instead of relying on the column default.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  VENUE: 'a0000000-0000-0000-0000-00000000000a',
  OTHER: 'b0000000-0000-0000-0000-00000000000b',
  ops: [] as { table: string; op: string; payload?: unknown; eqs: [string, unknown][] }[],
  tables: [] as string[],
  uploads: [] as { bucket: string; path: string }[],
}))

vi.mock('../../lib/currentVenue', () => ({ currentVenueId: () => h.VENUE }))
vi.mock('../../lib/supabase', () => {
  // venue_settings (if anything still reads it for the folder) says a different venue, so a read there shows up.
  const row = { id: 'row-1', venue_id: h.OTHER, path: 'p', sort_order: 0 }
  const builder = (table: string) => {
    h.tables.push(table)
    const rec = { table, op: 'select', payload: undefined as unknown, eqs: [] as [string, unknown][] }
    h.ops.push(rec)
    const chain: Record<string, unknown> = {}
    for (const m of ['insert', 'update', 'upsert']) chain[m] = (payload: unknown) => { rec.op = m; rec.payload = payload; return chain }
    chain.delete = () => { rec.op = 'delete'; return chain }
    chain.eq = (c: string, v: unknown) => { rec.eqs.push([c, v]); return chain }
    for (const m of ['select', 'order', 'limit', 'in']) chain[m] = () => chain
    chain.single = () => Promise.resolve({ data: row, error: null })
    chain.maybeSingle = () => Promise.resolve({ data: row, error: null })
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [row], error: null }).then(resolve)
    return chain
  }
  return {
    supabase: {
      from: builder,
      rpc: () => Promise.resolve({ data: null, error: null }),
      storage: {
        from: (bucket: string) => ({
          upload: (path: string) => { h.uploads.push({ bucket, path }); return Promise.resolve({ data: { path }, error: null }) },
          remove: (paths: string[]) => Promise.resolve({ data: paths.map((name) => ({ name })), error: null }),
          list: () => Promise.resolve({ data: [], error: null }),
        }),
      },
    },
  }
})

const { VENUE } = h
import {
  addCourtPhoto, addCustomAmenity, saveBanner, saveInfoSection, savePaymentAccount, saveSocialLinks, setBuiltinAmenity,
} from './api'

const png = new Blob(['x'], { type: 'image/png' })
const webp = new Blob(['x'], { type: 'image/webp' })
const find = (table: string, op: string) => h.ops.find((o) => o.table === table && o.op === op)

beforeEach(() => {
  h.ops.length = 0
  h.tables.length = 0
  h.uploads.length = 0
})

describe('admin writes pass venue_id (T12.10)', () => {
  it('court_photos insert carries the venue id', async () => {
    await addCourtPhoto('c1', webp, 0)
    expect(find('court_photos', 'insert')?.payload).toMatchObject({ venue_id: VENUE, court_id: 'c1' })
  })

  it('venue_social_links upsert carries the venue id on every row', async () => {
    await saveSocialLinks({ facebook: 'https://fb.com/x', instagram: 'https://ig.com/x' } as Parameters<typeof saveSocialLinks>[0])
    const rows = find('venue_social_links', 'upsert')?.payload as { venue_id: string }[]
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.venue_id).toBe(VENUE)
  })

  it('venue_info_sections insert carries the venue id', async () => {
    await saveInfoSection(null, { title: 'Rules', body: 'Be kind' })
    expect(find('venue_info_sections', 'insert')?.payload).toMatchObject({ venue_id: VENUE, title: 'Rules' })
  })

  it('venue_amenities inserts (built-in and custom) carry the venue id', async () => {
    await setBuiltinAmenity('parking' as Parameters<typeof setBuiltinAmenity>[0], true)
    await addCustomAmenity('Showers')
    const inserts = h.ops.filter((o) => o.table === 'venue_amenities' && o.op === 'insert')
    expect(inserts).toHaveLength(2)
    expect(inserts[0].payload).toMatchObject({ venue_id: VENUE, builtin_key: 'parking' })
    expect(inserts[1].payload).toMatchObject({ venue_id: VENUE, custom_name: 'Showers' })
  })

  it('venue_payment_accounts insert carries the venue id', async () => {
    await savePaymentAccount(null, { label: 'GCash', account_name: 'Claudex', account_number: '0917' }, { kind: 'keep' })
    expect(find('venue_payment_accounts', 'insert')?.payload).toMatchObject({ venue_id: VENUE, label: 'GCash' })
  })

  it('banner updates filter on venue_id, not on the constant id', async () => {
    await saveBanner({ banner_path: null }, { alt: 'Courts at dusk' })
    const update = find('venue_settings', 'update')!
    expect(update.eqs).toContainEqual(['venue_id', VENUE])
    expect(update.eqs.map(([c]) => c)).not.toContain('id')
  })

  it('upload paths use the member\'s venue (currentVenueId), without reading venue_settings', async () => {
    await addCourtPhoto('c1', webp, 0)
    await savePaymentAccount(null, { label: 'GCash', account_name: 'C', account_number: '1' }, { kind: 'set', image: png })
    expect(h.uploads.map((u) => u.path.split('/')[0])).toEqual([VENUE, VENUE])
    expect(h.tables).not.toContain('venue_settings')
  })
})
