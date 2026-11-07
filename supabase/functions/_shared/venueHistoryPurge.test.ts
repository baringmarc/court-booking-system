// T17.29: the manifest, SQL builders and proof-file removal for the separately reviewed production test-data cleanup.
// Pure logic: the SQL is proven against a real local database by scripts/test-venue-history-purge.mjs.
import { describe, expect, it, vi } from 'vitest'
import {
  PROOF_BUCKET, backupSql, purgeSql, removeProofFiles, validateManifest,
  type PurgeManifest, type PurgeVenue,
} from './venueHistoryPurge.ts'
import type { CleanupStorage } from './venueCleanup.ts'

const VENUE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const VENUE2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const BK1 = '11111111-1111-4111-8111-111111111111'
const BK2 = '22222222-2222-4222-8222-222222222222'
const BK3 = '33333333-3333-4333-8333-333333333333'
const PAY1 = '44444444-4444-4444-8444-444444444444'
const CHG1 = '55555555-5555-4555-8555-555555555555'
const SES1 = '66666666-6666-4666-8666-666666666666'
const OTHER_BOOKING = '77777777-7777-4777-8777-777777777777'

function venue(over: Partial<PurgeVenue> = {}): PurgeVenue {
  return {
    venue_id: VENUE, slug: 'test-venue-one', bookings: [BK1, BK2], payments: [PAY1], charges: [CHG1], open_play_sessions: [SES1],
    counts: { booking_changes: 1, email_outbox: 2, guest_link_tokens: 1, paymongo_checkouts: 0, open_play_courts: 2 },
    proof_files: [`${BK1}/proof.png`],
    ...over,
  }
}
function manifest(over: Partial<PurgeManifest> = {}): PurgeManifest {
  return { project_ref: 'abcdefghijklmnop', venues: [venue()], ...over }
}
const two = (): PurgeManifest => manifest({
  venues: [venue(), venue({ venue_id: VENUE2, slug: 'test-venue-two', bookings: [BK3], payments: [], charges: [], open_play_sessions: [], proof_files: [] })],
})

describe('validateManifest', () => {
  it('accepts a complete manifest and returns it unchanged', () => {
    expect(validateManifest(manifest())).toEqual(manifest())
    expect(validateManifest(two())).toEqual(two())
  })

  it('accepts a venue with no history at all (all lists empty, all counts zero)', () => {
    const empty = venue({
      bookings: [], payments: [], charges: [], open_play_sessions: [], proof_files: [],
      counts: { booking_changes: 0, email_outbox: 0, guest_link_tokens: 0, paymongo_checkouts: 0, open_play_courts: 0 },
    })
    expect(() => validateManifest(manifest({ venues: [empty] }))).not.toThrow()
  })

  it.each([
    ['null', null],
    ['a string', 'manifest'],
    ['an object without venues', { project_ref: 'x' }],
    ['no venues', { project_ref: 'x', venues: [] }],
  ])('rejects %s', (_name, input) => {
    expect(() => validateManifest(input)).toThrow(Error)
  })

  it.each([
    ['a venue id that is not a uuid', manifest({ venues: [venue({ venue_id: 'claudex-courts' })] })],
    ['an empty venue id', manifest({ venues: [venue({ venue_id: '' })] })],
    ['a booking id that is not a uuid', manifest({ venues: [venue({ bookings: [BK1, 'not-a-uuid'], proof_files: [] })] })],
    ['a payment id that is not a uuid', manifest({ venues: [venue({ payments: ['pay-1'] })] })],
    ['a charge id that is not a uuid', manifest({ venues: [venue({ charges: ["1'; drop table bookings; --"] })] })],
    ['an open play session id that is not a uuid', manifest({ venues: [venue({ open_play_sessions: ['x'] })] })],
  ])('rejects %s', (_name, m) => {
    expect(() => validateManifest(m)).toThrow(Error)
  })

  it('rejects a venue listed twice', () => {
    expect(() => validateManifest(manifest({ venues: [venue(), venue({ slug: 'another-slug' })] }))).toThrow(Error)
  })

  it.each([['an empty slug', ''], ['a blank slug', '   ']])('rejects %s', (_name, slug) => {
    expect(() => validateManifest(manifest({ venues: [venue({ slug })] }))).toThrow(Error)
  })

  it.each([
    ['a negative count', { booking_changes: -1 }],
    ['a non-integer count', { email_outbox: 1.5 }],
    ['a NaN count', { guest_link_tokens: Number.NaN }],
    ['a count that is a string', { paymongo_checkouts: '2' }],
    ['a missing count', { open_play_courts: undefined }],
  ])('rejects %s', (_name, patch) => {
    const counts = { ...venue().counts, ...patch } as PurgeVenue['counts']
    expect(() => validateManifest(manifest({ venues: [venue({ counts })] }))).toThrow(Error)
  })

  it.each([
    ['a path without a folder', 'proof.png'],
    ['a path with two folders', `${BK1}/sub/proof.png`],
    ['an empty file name', `${BK1}/`],
    ['a folder that is not a uuid', 'folder/proof.png'],
    ['a leading slash', `/${BK1}/proof.png`],
    ['a traversal', `${BK1}/../${BK2}/proof.png`],
  ])('rejects a proof file with %s', (_name, path) => {
    expect(() => validateManifest(manifest({ venues: [venue({ proof_files: [path] })] }))).toThrow(Error)
  })

  it("rejects a proof file whose booking is not in that venue's bookings (even if another venue lists it)", () => {
    expect(() => validateManifest(manifest({ venues: [venue({ proof_files: [`${OTHER_BOOKING}/proof.png`] })] }))).toThrow(Error)
    const crossVenue = manifest({
      venues: [venue({ proof_files: [`${BK3}/proof.png`] }), venue({ venue_id: VENUE2, slug: 'test-venue-two', bookings: [BK3], proof_files: [] })],
    })
    expect(() => validateManifest(crossVenue)).toThrow(Error)
  })
})

describe('purgeSql', () => {
  const sql = purgeSql(manifest())

  it('is exactly one statement: a single do block, nothing after it', () => {
    expect(sql.trim()).toMatch(/^do\s+\$\$/i)
    expect(sql.trim()).toMatch(/\$\$\s*;?\s*$/)
    expect(sql.match(/\$\$/g)).toHaveLength(2)
  })

  it('embeds the venue id, slug and every booking, payment, charge and session id of the manifest', () => {
    for (const needle of [VENUE, 'test-venue-one', BK1, BK2, PAY1, CHG1, SES1, `${BK1}/proof.png`]) expect(sql).toContain(needle)
  })

  it('embeds every venue of a multi-venue manifest', () => {
    const s = purgeSql(two())
    for (const needle of [VENUE, VENUE2, 'test-venue-two', BK3]) expect(s).toContain(needle)
  })

  it('names every refusal hint', () => {
    for (const hint of ['venue_not_found', 'venue_slug_mismatch', 'venue_protected', 'invoiced_charge', 'manifest_mismatch']) expect(sql).toContain(hint)
  })

  it('locks the venue row and deletes open play sessions and bookings, never the venue itself', () => {
    expect(sql).toMatch(/for\s+update/i)
    expect(sql).toMatch(/delete\s+from\s+public\.open_play_sessions/i)
    expect(sql).toMatch(/delete\s+from\s+public\.bookings/i)
    expect(sql).not.toMatch(/delete\s+from\s+public\.(venues|courts|venue_members|profiles|venue_settings)\b/i)
    expect(sql).not.toMatch(/auth\.users/i)
  })

  it('deletes child bookings (parent_booking_id not null) before parents', () => {
    expect(sql).toMatch(/parent_booking_id\s+is\s+not\s+null/i)
  })

  it('does not accept an invalid manifest', () => {
    expect(() => purgeSql(manifest({ venues: [] }))).toThrow(Error)
  })
})

describe('backupSql', () => {
  const sql = backupSql(manifest())

  it('is exactly one select returning a single jsonb column named backup', () => {
    expect(sql.trim()).toMatch(/^(select|with)\b/i)
    expect(sql.trim().replace(/;\s*$/, '')).not.toContain(';')
    expect(sql).toMatch(/\bas\s+"?backup"?\b/i)
    expect(sql).not.toMatch(/\b(delete|update|insert|drop|truncate)\b/i)
  })

  it('embeds the manifest ids and reads every table the purge removes', () => {
    for (const needle of [VENUE, BK1, BK2, PAY1, CHG1, SES1]) expect(sql).toContain(needle)
    for (const table of ['bookings', 'payments', 'paymongo_checkouts', 'billing_charges', 'booking_changes', 'email_outbox', 'guest_link_tokens', 'open_play_sessions', 'open_play_courts']) {
      expect(sql).toContain(table)
    }
  })
})

type Hooks = { listError?: string; removeError?: string; removeKeeps?: boolean }

/** In-memory Storage; files are "bucket/path". `list` is one level deep and folders come back with id null. */
function fakeStorage(files: string[], hooks: Hooks = {}) {
  const store = new Set(files)
  const calls = { list: [] as { bucket: string; folder: string }[], remove: [] as { bucket: string; paths: string[] }[] }
  const storage: CleanupStorage = {
    async list(bucket, folder, opts) {
      calls.list.push({ bucket, folder })
      if (hooks.listError) return { data: null, error: { message: hooks.listError } }
      const start = `${bucket}/${folder.replace(/\/+$/, '')}/`
      const names = new Set<string>()
      for (const f of store) if (f.startsWith(start)) names.add(f.slice(start.length).split('/')[0])
      const page = [...names].sort().slice(opts.offset, opts.offset + Math.min(opts.limit, 100)).map((name) => ({ name, id: `id-${start}${name}` }))
      return { data: page, error: null }
    },
    async remove(bucket, paths) {
      calls.remove.push({ bucket, paths })
      if (hooks.removeError) return { error: { message: hooks.removeError } }
      if (!hooks.removeKeeps) for (const p of paths) store.delete(`${bucket}/${p}`)
      return { error: null }
    },
  }
  return { storage, calls, store }
}

describe('removeProofFiles', () => {
  const m = manifest({ venues: [venue({ bookings: [BK1, BK2], proof_files: [`${BK1}/proof.png`, `${BK2}/receipt.jpg`] })] })
  const files = [
    `${PROOF_BUCKET}/${BK1}/proof.png`, `${PROOF_BUCKET}/${BK2}/receipt.jpg`,
    `${PROOF_BUCKET}/${BK1}/not-in-manifest.png`, `${PROOF_BUCKET}/${OTHER_BOOKING}/other.png`,
    `venue-media/${VENUE}/banner.png`,
  ]
  const notReferenced = async () => false

  it('uses the payment-proofs bucket', () => {
    expect(PROOF_BUCKET).toBe('payment-proofs')
  })

  it('removes exactly the manifest paths from payment-proofs and reports them', async () => {
    const { storage, calls, store } = fakeStorage(files)
    const out = await removeProofFiles(storage, m, notReferenced)
    expect([...out.removed].sort()).toEqual([`${BK1}/proof.png`, `${BK2}/receipt.jpg`])
    expect(calls.remove.length).toBeGreaterThan(0)
    for (const c of calls.remove) expect(c.bucket).toBe(PROOF_BUCKET)
    expect(calls.remove.flatMap((c) => c.paths).sort()).toEqual([`${BK1}/proof.png`, `${BK2}/receipt.jpg`])
    // other files in the same folder, other folders and other buckets stay
    expect([...store].sort()).toEqual([
      `${PROOF_BUCKET}/${BK1}/not-in-manifest.png`, `${PROOF_BUCKET}/${OTHER_BOOKING}/other.png`, `venue-media/${VENUE}/banner.png`,
    ].sort())
  })

  it('checks every manifest path with isReferenced before removing anything', async () => {
    const { storage, calls } = fakeStorage(files)
    const seen: string[] = []
    const isReferenced = vi.fn(async (path: string) => { seen.push(path); expect(calls.remove).toHaveLength(0); return false })
    await removeProofFiles(storage, m, isReferenced)
    expect(seen.sort()).toEqual([`${BK1}/proof.png`, `${BK2}/receipt.jpg`])
  })

  it('refuses, removing nothing, when any path is still referenced by a payments row', async () => {
    const { storage, calls, store } = fakeStorage(files)
    await expect(removeProofFiles(storage, m, async (path) => path === `${BK2}/receipt.jpg`)).rejects.toThrow(Error)
    expect(calls.remove).toHaveLength(0)
    expect(store.size).toBe(files.length)
  })

  it('throws when a removed file is still listed afterwards', async () => {
    const { storage } = fakeStorage(files, { removeKeeps: true })
    await expect(removeProofFiles(storage, m, notReferenced)).rejects.toThrow(Error)
  })

  it('throws on a storage remove error, with its message', async () => {
    const { storage } = fakeStorage(files, { removeError: 'remove boom' })
    await expect(removeProofFiles(storage, m, notReferenced)).rejects.toThrow(/remove boom/)
  })

  it('throws on a storage list error', async () => {
    const { storage } = fakeStorage(files, { listError: 'list boom' })
    await expect(removeProofFiles(storage, m, notReferenced)).rejects.toThrow(/list boom/)
  })

  it('with no proof files removes nothing and reports an empty list', async () => {
    const { storage, calls, store } = fakeStorage(files)
    const empty = manifest({ venues: [venue({ proof_files: [] })] })
    const out = await removeProofFiles(storage, empty, notReferenced)
    expect(out).toEqual({ removed: [] })
    expect(calls.remove.every((c) => c.paths.length === 0)).toBe(true)
    expect(store.size).toBe(files.length)
  })

  it('removes the proofs of every venue in the manifest', async () => {
    const both = manifest({
      venues: [
        venue({ proof_files: [`${BK1}/proof.png`] }),
        venue({ venue_id: VENUE2, slug: 'test-venue-two', bookings: [BK3], payments: [], charges: [], open_play_sessions: [], proof_files: [`${BK3}/p.png`] }),
      ],
    })
    const { storage, store } = fakeStorage([`${PROOF_BUCKET}/${BK1}/proof.png`, `${PROOF_BUCKET}/${BK3}/p.png`, `${PROOF_BUCKET}/${BK2}/keep.png`])
    const out = await removeProofFiles(storage, both, notReferenced)
    expect([...out.removed].sort()).toEqual([`${BK1}/proof.png`, `${BK3}/p.png`])
    expect([...store]).toEqual([`${PROOF_BUCKET}/${BK2}/keep.png`])
  })
})
