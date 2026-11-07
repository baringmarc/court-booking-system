// T17.27: the storage cleanup worker for deleted venues. Pure logic over an in-memory queue and Storage, so the
// failure paths (list or remove errors, a remove that silently keeps files, a thrown error) run without a network.
import { describe, expect, it, vi } from 'vitest'
import {
  CLEANUP_BUCKETS, drainVenueFileCleanup, isVenuePrefix, storageAdapter,
  type CleanupQueue, type CleanupStorage, type ClaimedCleanup,
} from './venueCleanup.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

function row(over: Partial<ClaimedCleanup> = {}): ClaimedCleanup {
  return { id: 'r1', venue_id: A, bucket: 'venue-media', prefix: `${A}/`, ...over }
}

/** A queue holding `rows`; records every claim and finish. */
function fakeQueue(rows: ClaimedCleanup[]) {
  const finished: { id: string; ok: boolean; error: string | null }[] = []
  const claim = vi.fn(async (limit: number) => rows.slice(0, limit))
  const queue: CleanupQueue = {
    claim,
    finish: async (id, ok, error) => { finished.push({ id, ok, error }) },
  }
  return { queue, claim, finished }
}

type Hooks = { listError?: (bucket: string, folder: string) => string | null; removeError?: (call: number) => string | null; removeKeeps?: boolean; throwOn?: string }

/** In-memory Storage: `files` are "bucket/path". `list` is one level deep and paged, folders come back with id null. */
function fakeStorage(files: string[], hooks: Hooks = {}) {
  const store = new Set(files)
  const calls = { list: [] as { bucket: string; folder: string }[], remove: [] as { bucket: string; paths: string[] }[] }
  let removeCalls = 0
  const storage: CleanupStorage = {
    async list(bucket, folder, opts) {
      calls.list.push({ bucket, folder })
      if (hooks.throwOn && bucket === hooks.throwOn) throw new Error('storage exploded')
      const message = hooks.listError?.(bucket, folder)
      if (message) return { data: null, error: { message } }
      const base = folder.replace(/\/+$/, '')
      const start = `${bucket}/${base}${base === '' ? '' : '/'}`
      const children = new Map<string, string | null>()
      for (const f of store) {
        if (!f.startsWith(start)) continue
        const rest = f.slice(start.length)
        const [first, ...tail] = rest.split('/')
        children.set(first, tail.length > 0 ? null : `id-${f}`)
      }
      const page = [...children.entries()].sort(([a], [b]) => a.localeCompare(b))
        .slice(opts.offset, opts.offset + Math.min(opts.limit, 100))
        .map(([name, id]) => ({ name, id }))
      return { data: page, error: null }
    },
    async remove(bucket, paths) {
      calls.remove.push({ bucket, paths })
      removeCalls += 1
      const message = hooks.removeError?.(removeCalls)
      if (message) return { error: { message } }
      if (!hooks.removeKeeps) for (const p of paths) store.delete(`${bucket}/${p}`)
      return { error: null }
    },
  }
  return { storage, calls, store }
}

describe('isVenuePrefix', () => {
  it('accepts exactly {venue_id}/ in a cleanup bucket', () => {
    expect(isVenuePrefix(row())).toBe(true)
    expect(isVenuePrefix(row({ bucket: 'payment-qr' }))).toBe(true)
  })

  it.each([
    ['another bucket', row({ bucket: 'payment-proofs' })],
    ['an empty prefix', row({ prefix: '' })],
    ['a bare slash', row({ prefix: '/' })],
    ['a prefix of another venue', row({ prefix: `${B}/` })],
    ['no trailing slash', row({ prefix: A })],
    ['a deeper path', row({ prefix: `${A}/courts/` })],
    ['a leading slash', row({ prefix: `/${A}/` })],
    ['a parent traversal', row({ prefix: `${A}/../` })],
    ['a venue_id that is not a uuid', row({ venue_id: 'claudex-courts', prefix: 'claudex-courts/' })],
    ['an empty venue_id', row({ venue_id: '', prefix: '/' })],
  ])('refuses %s', (_name, r) => {
    expect(isVenuePrefix(r)).toBe(false)
  })

  it('knows exactly the two venue buckets', () => {
    expect([...CLEANUP_BUCKETS].sort()).toEqual(['payment-qr', 'venue-media'])
  })
})

describe('drainVenueFileCleanup', () => {
  it('claims once with a default limit of 100 and a given limit otherwise; an empty queue touches nothing', async () => {
    const { queue, claim } = fakeQueue([])
    const { storage, calls } = fakeStorage([])
    expect(await drainVenueFileCleanup(queue, storage)).toEqual({ done: [], failed: [] })
    expect(claim).toHaveBeenCalledTimes(1)
    expect(claim).toHaveBeenCalledWith(100)
    await drainVenueFileCleanup(queue, storage, 7)
    expect(claim).toHaveBeenLastCalledWith(7)
    expect(calls.list).toHaveLength(0)
    expect(calls.remove).toHaveLength(0)
  })

  it('removes nested files in every folder and finishes the row ok with a null error', async () => {
    const files = [
      `venue-media/${A}/banner/b.png`, `venue-media/${A}/courts/c1/photos/p1.png`, `venue-media/${A}/courts/c1/p2.png`,
      `venue-media/${A}/logo.png`, `venue-media/${A}/a/b/c/d/deep.png`,
    ]
    const { queue, finished } = fakeQueue([row()])
    const { storage, store } = fakeStorage(files)
    const out = await drainVenueFileCleanup(queue, storage)
    expect(store.size).toBe(0)
    expect(out.done).toEqual([row()])
    expect(out.failed).toEqual([])
    expect(finished).toEqual([{ id: 'r1', ok: true, error: null }])
  })

  it('passes remove paths as folder/name: relative, no leading or double slash, inside the prefix', async () => {
    const { queue } = fakeQueue([row()])
    const { storage, calls } = fakeStorage([`venue-media/${A}/courts/c1/p.png`, `venue-media/${A}/x.png`])
    await drainVenueFileCleanup(queue, storage)
    const paths = calls.remove.flatMap((c) => c.paths)
    expect(paths.sort()).toEqual([`${A}/courts/c1/p.png`, `${A}/x.png`])
    for (const p of paths) expect(p).toMatch(new RegExp(`^${A}/[^/]`))
    for (const c of calls.remove) expect(c.bucket).toBe('venue-media')
  })

  it('treats a prefix with no files as done (nothing to remove)', async () => {
    const { queue, finished } = fakeQueue([row()])
    const { storage, calls } = fakeStorage([])
    const out = await drainVenueFileCleanup(queue, storage)
    expect(out.done).toHaveLength(1)
    expect(finished).toEqual([{ id: 'r1', ok: true, error: null }])
    expect(calls.remove.every((c) => c.paths.length === 0)).toBe(true)
  })

  it('removes more files than one list page holds', async () => {
    const files = Array.from({ length: 250 }, (_, i) => `venue-media/${A}/many/f${String(i).padStart(3, '0')}.png`)
    const { queue, finished } = fakeQueue([row()])
    const { storage, store } = fakeStorage(files)
    await drainVenueFileCleanup(queue, storage)
    expect(store.size).toBe(0)
    expect(finished).toEqual([{ id: 'r1', ok: true, error: null }])
  })

  it('never touches another venue, another bucket or a sibling prefix with the same start', async () => {
    const keep = [
      `venue-media/${B}/banner/b.png`, `payment-qr/${A}/qr.png`, `payment-qr/${B}/qr.png`,
      `venue-media/${A}x/other.png`, `venue-media/other-${A}/o.png`,
    ]
    const { queue } = fakeQueue([row()])
    const { storage, store, calls } = fakeStorage([`venue-media/${A}/gone.png`, ...keep])
    await drainVenueFileCleanup(queue, storage)
    expect([...store].sort()).toEqual([...keep].sort())
    for (const c of calls.remove) for (const p of c.paths) expect(p.startsWith(`${A}/`)).toBe(true)
  })

  it('handles the venue-media and payment-qr rows of one venue', async () => {
    const { queue, finished } = fakeQueue([row({ id: 'r1' }), row({ id: 'r2', bucket: 'payment-qr' })])
    const { storage, store } = fakeStorage([`venue-media/${A}/m.png`, `payment-qr/${A}/q.png`, `payment-qr/${B}/q.png`])
    const out = await drainVenueFileCleanup(queue, storage)
    expect(out.done.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect([...store]).toEqual([`payment-qr/${B}/q.png`])
    expect(finished.map((f) => f.ok)).toEqual([true, true])
  })

  it.each([
    ['another bucket', row({ bucket: 'payment-proofs', prefix: `${A}/` })],
    ['a prefix that is not the venue folder', row({ prefix: '' })],
    ['a prefix of a different venue', row({ prefix: `${B}/` })],
    ['a venue_id that is not a uuid', row({ venue_id: 'x', prefix: 'x/' })],
  ])('refuses a row with %s: finishes it failed with an error and makes no storage call', async (_name, bad) => {
    const { queue, finished } = fakeQueue([bad])
    const { storage, calls, store } = fakeStorage([`venue-media/${A}/keep.png`, `venue-media/${B}/keep.png`, `payment-proofs/${A}/proof.png`])
    const out = await drainVenueFileCleanup(queue, storage)
    expect(calls.list).toHaveLength(0)
    expect(calls.remove).toHaveLength(0)
    expect(store.size).toBe(3)
    expect(out.done).toEqual([])
    expect(out.failed).toHaveLength(1)
    expect(out.failed[0].id).toBe('r1')
    expect(out.failed[0].error).not.toBe('')
    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({ id: 'r1', ok: false })
    expect(finished[0].error).toBeTruthy()
  })

  it('a list error fails the row with that message and the other rows still run', async () => {
    const { queue, finished } = fakeQueue([row({ id: 'r1' }), row({ id: 'r2', bucket: 'payment-qr' })])
    const { storage, store } = fakeStorage([`venue-media/${A}/m.png`, `payment-qr/${A}/q.png`], {
      listError: (bucket) => (bucket === 'venue-media' ? 'list boom' : null),
    })
    const out = await drainVenueFileCleanup(queue, storage)
    expect(out.failed.map((r) => r.id)).toEqual(['r1'])
    expect(out.failed[0].error).toContain('list boom')
    expect(out.done.map((r) => r.id)).toEqual(['r2'])
    expect(finished.find((f) => f.id === 'r1')).toMatchObject({ ok: false })
    expect(finished.find((f) => f.id === 'r1')?.error).toContain('list boom')
    expect(finished.find((f) => f.id === 'r2')).toEqual({ id: 'r2', ok: true, error: null })
    expect(store.has(`venue-media/${A}/m.png`)).toBe(true)
    expect(store.has(`payment-qr/${A}/q.png`)).toBe(false)
  })

  it('a remove error fails the row; a later drain retries and finishes it', async () => {
    const files = [`venue-media/${A}/a.png`, `venue-media/${A}/n/b.png`]
    const pending = [row()]
    const { queue, finished } = fakeQueue(pending)
    const { storage, store } = fakeStorage(files, { removeError: (call) => (call === 1 ? 'remove boom' : null) })
    const first = await drainVenueFileCleanup(queue, storage)
    expect(first.done).toEqual([])
    expect(first.failed).toHaveLength(1)
    expect(first.failed[0].error).toContain('remove boom')
    expect(finished[0]).toMatchObject({ id: 'r1', ok: false })
    expect(store.size).toBeGreaterThan(0)

    const second = await drainVenueFileCleanup(queue, storage)
    expect(second.done).toHaveLength(1)
    expect(second.failed).toEqual([])
    expect(store.size).toBe(0)
    expect(finished[1]).toEqual({ id: 'r1', ok: true, error: null })
  })

  it('does not call a row done when a remove reports success but files remain', async () => {
    const { queue, finished } = fakeQueue([row()])
    const { storage } = fakeStorage([`venue-media/${A}/stuck.png`], { removeKeeps: true })
    const out = await drainVenueFileCleanup(queue, storage)
    expect(out.done).toEqual([])
    expect(out.failed).toHaveLength(1)
    expect(out.failed[0].error).toBeTruthy()
    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({ ok: false })
    expect(finished[0].error).toBeTruthy()
  })

  it('a thrown storage error fails only that row', async () => {
    const { queue, finished } = fakeQueue([row({ id: 'r1' }), row({ id: 'r2', bucket: 'payment-qr' })])
    const { storage } = fakeStorage([`payment-qr/${A}/q.png`], { throwOn: 'venue-media' })
    const out = await drainVenueFileCleanup(queue, storage)
    expect(out.failed.map((r) => r.id)).toEqual(['r1'])
    expect(out.failed[0].error).toContain('storage exploded')
    expect(out.done.map((r) => r.id)).toEqual(['r2'])
    expect(finished.map((f) => [f.id, f.ok])).toEqual([['r1', false], ['r2', true]])
  })
})

describe('storageAdapter', () => {
  it('lists with limit and offset and removes by paths on the named bucket', async () => {
    const list = vi.fn(async () => ({ data: [{ name: 'a', id: 'x' }], error: null }))
    const remove = vi.fn(async () => ({ data: [], error: null }))
    const from = vi.fn(() => ({ list, remove }))
    const adapter = storageAdapter({ storage: { from } } as never)
    const listed = await adapter.list('venue-media', `${A}/banner`, { limit: 100, offset: 200 })
    expect(from).toHaveBeenCalledWith('venue-media')
    expect(list).toHaveBeenCalledWith(`${A}/banner`, expect.objectContaining({ limit: 100, offset: 200 }))
    expect(listed).toEqual({ data: [{ name: 'a', id: 'x' }], error: null })
    expect(await adapter.remove('payment-qr', [`${A}/q.png`])).toEqual({ error: null })
    expect(from).toHaveBeenLastCalledWith('payment-qr')
    expect(remove).toHaveBeenCalledWith([`${A}/q.png`])
  })

  it('passes a Storage error through as { message }', async () => {
    const from = () => ({ list: async () => ({ data: null, error: { message: 'nope' } }), remove: async () => ({ data: null, error: { message: 'no remove' } }) })
    const adapter = storageAdapter({ storage: { from } } as never)
    expect((await adapter.list('venue-media', A, { limit: 1, offset: 0 })).error?.message).toBe('nope')
    expect((await adapter.remove('venue-media', [`${A}/x`])).error?.message).toBe('no remove')
  })
})
