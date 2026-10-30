// T12.7: new uploads are prefixed with the admin's venue id (venue_settings.venue_id), so the storage policies can
// decide on the first folder. Court photos {venue}/courts/{courtId}/{uuid}.{ext}, banner {venue}/banner/{uuid}.{ext},
// payment QR {venue}/{uuid}.png. The venue id is read from venue_settings, never passed in by the caller.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

const h = vi.hoisted(() => ({
  VENUE: 'a0000000-0000-0000-0000-00000000000a',
  COURT: 'c0000000-0000-0000-0000-0000000000a1',
  uploads: [] as { bucket: string; path: string }[],
  removed: [] as { bucket: string; paths: string[] }[],
  listed: [] as { bucket: string; folder: string }[],
}))

// T12.10: the venue now comes from the admin's membership (currentAdminVenueId), no longer venue_settings.
vi.mock('../auth/api', () => ({ currentAdminVenueId: vi.fn(async () => h.VENUE) }))

vi.mock('../../lib/supabase', () => {
  // A chainable, awaitable query builder: every method returns it; awaiting or .single() resolves with the venue row.
  const row = { id: 'row-1', venue_id: h.VENUE, path: `${h.VENUE}/courts/${h.COURT}/old.webp`, sort_order: 0, banner_path: null, qr_path: null }
  const chain: Record<string, unknown> = {}
  const result = { data: row, error: null }
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit']) chain[m] = () => chain
  chain.single = () => Promise.resolve(result)
  chain.maybeSingle = () => Promise.resolve(result)
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [row], error: null }).then(resolve)
  return {
    supabase: {
      from: () => chain,
      rpc: () => Promise.resolve({ data: null, error: null }),
      storage: {
        from: (bucket: string) => ({
          upload: (path: string) => { h.uploads.push({ bucket, path }); return Promise.resolve({ data: { path }, error: null }) },
          remove: (paths: string[]) => { h.removed.push({ bucket, paths }); return Promise.resolve({ data: paths.map((name) => ({ name })), error: null }) },
          list: (folder: string) => { h.listed.push({ bucket, folder }); return Promise.resolve({ data: [{ name: 'p1.webp' }], error: null }) },
        }),
      },
    },
  }
})

const { VENUE, COURT } = h
import { addCourtPhoto, deleteCourt, saveBanner, savePaymentAccount } from './api'

const png = new Blob(['x'], { type: 'image/png' })
const webp = new Blob(['x'], { type: 'image/webp' })

beforeEach(() => {
  h.uploads.length = 0
  h.removed.length = 0
  h.listed.length = 0
})

describe('venue-prefixed upload paths (T12.7)', () => {
  it('uploads a court photo to venue-media at {venue_id}/courts/{courtId}/{uuid}.webp', async () => {
    await addCourtPhoto(COURT, webp, 0)
    expect(h.uploads).toHaveLength(1)
    expect(h.uploads[0].bucket).toBe('venue-media')
    expect(h.uploads[0].path).toMatch(new RegExp(`^${VENUE}/courts/${COURT}/${UUID}\\.webp$`))
  })

  it('uploads the banner to venue-media at {venue_id}/banner/{uuid}.png', async () => {
    await saveBanner({ banner_path: null }, { alt: 'Courts at dusk', image: png })
    expect(h.uploads).toHaveLength(1)
    expect(h.uploads[0].bucket).toBe('venue-media')
    expect(h.uploads[0].path).toMatch(new RegExp(`^${VENUE}/banner/${UUID}\\.png$`))
  })

  it('uploads a payment QR to payment-qr at {venue_id}/{uuid}.png', async () => {
    await savePaymentAccount(null, { label: 'GCash', account_name: 'Claudex', account_number: '0917' }, { kind: 'set', image: png })
    expect(h.uploads).toHaveLength(1)
    expect(h.uploads[0].bucket).toBe('payment-qr')
    expect(h.uploads[0].path).toMatch(new RegExp(`^${VENUE}/${UUID}\\.png$`))
  })

  it('replacing a QR uploads under the venue and removes the old (legacy-shaped) path as stored', async () => {
    await savePaymentAccount({ id: 'acc-1', qr_path: 'legacy-0000.png' }, { label: 'GCash', account_name: 'Claudex', account_number: '0917' }, { kind: 'set', image: png })
    expect(h.uploads[0].path).toMatch(new RegExp(`^${VENUE}/${UUID}\\.png$`))
    expect(h.removed).toEqual([{ bucket: 'payment-qr', paths: ['legacy-0000.png'] }])
  })

  it('deleting a court lists and removes the files in its folder under the venue prefix', async () => {
    await deleteCourt(COURT)
    expect(h.listed).toEqual([{ bucket: 'venue-media', folder: `${VENUE}/courts/${COURT}` }])
    expect(h.removed).toEqual([{ bucket: 'venue-media', paths: [`${VENUE}/courts/${COURT}/p1.webp`] }])
  })
})
