// T26.5: Plotline's payment accounts: table platform_payment_accounts, private bucket platform-billing, top-level <uuid>.png.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

const h = vi.hoisted(() => ({
  log: [] as string[],
  tables: [] as string[],
  writes: [] as { op: string; payload: unknown }[],
  uploads: [] as { bucket: string; path: string; options: unknown }[],
  removed: [] as { bucket: string; paths: string[] }[],
  signed: [] as { bucket: string; path: string; ttl: number }[],
  rpcs: [] as { name: string; args: unknown }[],
  orders: [] as { column: string }[],
  signedResult: { data: { signedUrl: 'https://signed.test/x' } as { signedUrl: string } | null, error: null as { message: string } | null },
}))

vi.mock('../../lib/supabase', () => {
  const rows = [{ id: 'row-1', label: 'GCash' }]
  const make = () => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'limit']) chain[m] = () => chain
    for (const op of ['insert', 'update']) {
      chain[op] = (payload: unknown) => { h.writes.push({ op, payload }); h.log.push(`row:${op}`); return chain }
    }
    chain.delete = () => { h.writes.push({ op: 'delete', payload: null }); h.log.push('row:delete'); return chain }
    chain.order = (column: string) => { h.orders.push({ column }); return chain }
    chain.single = () => Promise.resolve({ data: { id: 'row-1' }, error: null })
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve)
    return chain
  }
  return {
    supabase: {
      from: (table: string) => { h.tables.push(table); return make() },
      rpc: (name: string, args: unknown) => { h.rpcs.push({ name, args }); return Promise.resolve({ data: null, error: null }) },
      storage: {
        from: (bucket: string) => ({
          upload: (path: string, _b: unknown, options: unknown) => { h.uploads.push({ bucket, path, options }); h.log.push('file:upload'); return Promise.resolve({ data: { path }, error: null }) },
          remove: (paths: string[]) => {
            h.removed.push({ bucket, paths }); h.log.push('file:remove')
            return Promise.resolve({ data: paths.map((name) => ({ name })), error: null })
          },
          createSignedUrl: (path: string, ttl: number) => { h.signed.push({ bucket, path, ttl }); return Promise.resolve(h.signedResult) },
        }),
      },
    },
  }
})

const {
  fetchPlatformPaymentAccounts, savePlatformPaymentAccount, deletePlatformPaymentAccount, reorderPlatformPaymentAccounts, platformQrUrl,
} = await import('./api')

const input = { label: 'GCash', account_name: 'Plotline Inc.', account_number: '0917' }
const png = new Blob(['x'], { type: 'image/png' })

beforeEach(() => {
  for (const k of ['log', 'tables', 'writes', 'uploads', 'removed', 'signed', 'rpcs', 'orders'] as const) h[k].length = 0
  h.signedResult = { data: { signedUrl: 'https://signed.test/x' }, error: null }
})

describe('platform payment accounts api', () => {
  it('fetchPlatformPaymentAccounts reads platform_payment_accounts ordered by position', async () => {
    const rows = await fetchPlatformPaymentAccounts()
    expect(h.tables).toEqual(['platform_payment_accounts'])
    expect(h.orders[0].column).toBe('position')
    expect(rows).toEqual([{ id: 'row-1', label: 'GCash' }])
  })

  it('a new account with a QR uploads to platform-billing at a top-level <uuid>.png as image/png, then inserts without position or venue_id', async () => {
    await savePlatformPaymentAccount(null, input, { kind: 'set', image: png })
    expect(h.uploads).toHaveLength(1)
    expect(h.uploads[0].bucket).toBe('platform-billing')
    expect(h.uploads[0].path).toMatch(new RegExp(`^${UUID}\\.png$`))
    expect(h.uploads[0].options).toMatchObject({ contentType: 'image/png' })
    expect(h.tables).toEqual(['platform_payment_accounts'])
    expect(h.log).toEqual(['file:upload', 'row:insert'])
    const payload = h.writes[0].payload as Record<string, unknown>
    expect(payload).toEqual({ ...input, qr_path: h.uploads[0].path })
    expect(payload).not.toHaveProperty('position')
    expect(payload).not.toHaveProperty('venue_id')
  })

  it('a new account without a QR uploads nothing and inserts qr_path null', async () => {
    await savePlatformPaymentAccount(null, input, { kind: 'keep' })
    expect(h.uploads).toHaveLength(0)
    expect(h.writes[0]).toEqual({ op: 'insert', payload: { ...input, qr_path: null } })
  })

  it('replacing a QR uploads the new file, updates the row, then removes the old file from platform-billing', async () => {
    await savePlatformPaymentAccount({ id: 'row-1', qr_path: 'old.png' }, input, { kind: 'set', image: png })
    expect(h.log).toEqual(['file:upload', 'row:update', 'file:remove'])
    expect(h.removed).toEqual([{ bucket: 'platform-billing', paths: ['old.png'] }])
    const payload = h.writes[0].payload as Record<string, unknown>
    expect(payload).toEqual({ ...input, qr_path: h.uploads[0].path })
    expect(payload).not.toHaveProperty('position')
  })

  it('clearing a QR updates qr_path to null, then removes the file', async () => {
    await savePlatformPaymentAccount({ id: 'row-1', qr_path: 'old.png' }, input, { kind: 'clear' })
    expect(h.log).toEqual(['row:update', 'file:remove'])
    expect(h.writes[0].payload).toEqual({ ...input, qr_path: null })
    expect(h.removed).toEqual([{ bucket: 'platform-billing', paths: ['old.png'] }])
  })

  it('editing with the QR kept updates the fields only, touching no file', async () => {
    await savePlatformPaymentAccount({ id: 'row-1', qr_path: 'old.png' }, input, { kind: 'keep' })
    expect(h.writes).toEqual([{ op: 'update', payload: input }])
    expect(h.uploads).toHaveLength(0)
    expect(h.removed).toHaveLength(0)
  })

  it('deleting removes the row first, then the QR file from platform-billing', async () => {
    await deletePlatformPaymentAccount({ id: 'row-1', qr_path: 'old.png' })
    expect(h.tables).toEqual(['platform_payment_accounts'])
    expect(h.log).toEqual(['row:delete', 'file:remove'])
    expect(h.removed).toEqual([{ bucket: 'platform-billing', paths: ['old.png'] }])
  })

  it('deleting an account without a QR removes no file', async () => {
    await deletePlatformPaymentAccount({ id: 'row-1', qr_path: null })
    expect(h.log).toEqual(['row:delete'])
  })

  it('reorderPlatformPaymentAccounts calls reorder_platform_payment_accounts with p_ids', async () => {
    await reorderPlatformPaymentAccounts(['b', 'a'])
    expect(h.rpcs).toEqual([{ name: 'reorder_platform_payment_accounts', args: { p_ids: ['b', 'a'] } }])
  })

  it('platformQrUrl signs the path in platform-billing for an hour and returns the url', async () => {
    expect(await platformQrUrl('q.png')).toBe('https://signed.test/x')
    expect(h.signed).toEqual([{ bucket: 'platform-billing', path: 'q.png', ttl: 3600 }])
  })

  it('platformQrUrl rejects when signing fails', async () => {
    h.signedResult = { data: null, error: { message: 'Object not found' } }
    await expect(platformQrUrl('q.png')).rejects.toBeTruthy()
  })
})
