// The file-cleanup worker for deleted venues (T17.27). delete_unused_venue (T17.26) queues each venue's Storage
// prefixes in private.venue_file_cleanup; this drains the queue through the Storage API (never by deleting
// storage.objects rows). Pure over the two interfaces below, so the delete-unused-venue function and the e2e tests
// share it. Keep the syntax erasable (e2e imports it directly).

export type ClaimedCleanup = { id: string; venue_id: string; bucket: string; prefix: string }

export type CleanupQueue = {
  claim(limit: number): Promise<ClaimedCleanup[]>
  finish(id: string, ok: boolean, error: string | null): Promise<void>
}

export type CleanupStorage = {
  list(bucket: string, folder: string, opts: { limit: number; offset: number }): Promise<{ data: { name: string; id: string | null }[] | null; error: { message: string } | null }>
  remove(bucket: string, paths: string[]): Promise<{ error: { message: string } | null }>
}

/** The buckets that hold venue files under `{venue_id}/` (payment proofs are per booking, and booking venues are never deleted). */
export const CLEANUP_BUCKETS: readonly string[] = ['venue-media', 'payment-qr']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE = 100

/** A queued row may only name `{venue_id}/` in a venue bucket, so a bad row can never reach another venue's files. */
export function isVenuePrefix(row: ClaimedCleanup): boolean {
  return CLEANUP_BUCKETS.includes(row.bucket) && UUID.test(row.venue_id) && row.prefix === `${row.venue_id}/`
}

type StorageClient = {
  storage: {
    from(bucket: string): {
      list(folder: string, opts: { limit: number; offset: number }): Promise<{ data: { name: string; id: string | null }[] | null; error: { message: string } | null }>
      remove(paths: string[]): Promise<{ error: { message: string } | null }>
    }
  }
}

/** Storage through a supabase-js client (the service-role client in the function). */
export function storageAdapter(client: StorageClient): CleanupStorage {
  return {
    async list(bucket, folder, opts) {
      const { data, error } = await client.storage.from(bucket).list(folder, { limit: opts.limit, offset: opts.offset })
      return { data: data ?? null, error: error ? { message: error.message } : null }
    },
    async remove(bucket, paths) {
      const { error } = await client.storage.from(bucket).remove(paths)
      return { error: error ? { message: error.message } : null }
    },
  }
}

/** Every file path under `folder`, walking subfolders (Storage lists one level, folders have a null id). */
export async function filesUnder(storage: CleanupStorage, bucket: string, folder: string): Promise<string[]> {
  const files: string[] = []
  const folders = [folder]
  while (folders.length > 0) {
    const current = folders.pop()!
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await storage.list(bucket, current, { limit: PAGE, offset })
      if (error) throw new Error(`list ${bucket}/${current}: ${error.message}`)
      const entries = data ?? []
      for (const entry of entries) (entry.id === null ? folders : files).push(`${current}/${entry.name}`)
      if (entries.length < PAGE) break
    }
  }
  return files
}

/** Removes every file under one row's prefix; throws unless the prefix is empty afterwards. */
async function cleanRow(storage: CleanupStorage, row: ClaimedCleanup): Promise<void> {
  const folder = row.prefix.replace(/\/$/, '')
  const files = await filesUnder(storage, row.bucket, folder)
  for (let i = 0; i < files.length; i += PAGE) {
    const { error } = await storage.remove(row.bucket, files.slice(i, i + PAGE))
    if (error) throw new Error(`remove ${row.bucket}/${row.prefix}: ${error.message}`)
  }
  const left = await filesUnder(storage, row.bucket, folder)
  if (left.length > 0) throw new Error(`${left.length} file(s) still in ${row.bucket}/${row.prefix} after removal`)
}

/** How many files are still stored under the venue's folders in every cleanup bucket (the truth a reply rests on). */
export async function venueFilesLeft(storage: CleanupStorage, venueId: string): Promise<number> {
  let left = 0
  for (const bucket of CLEANUP_BUCKETS) left += (await filesUnder(storage, bucket, venueId)).length
  return left
}

/**
 * Claims up to `limit` pending or failed rows once and cleans each. A row is finished `done` only when its prefix is
 * verifiably empty; any error finishes it `failed` (retried by a later drain) without stopping the others.
 */
export async function drainVenueFileCleanup(queue: CleanupQueue, storage: CleanupStorage, limit = 100):
  Promise<{ done: ClaimedCleanup[]; failed: (ClaimedCleanup & { error: string })[] }> {
  const done: ClaimedCleanup[] = []
  const failed: (ClaimedCleanup & { error: string })[] = []
  for (const row of await queue.claim(limit)) {
    let error: string | null = null
    if (!isVenuePrefix(row)) error = `refused: ${row.bucket}/${row.prefix} is not a venue folder`
    else {
      try {
        await cleanRow(storage, row)
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }
    }
    await queue.finish(row.id, error === null, error)
    if (error === null) done.push(row)
    else failed.push({ ...row, error })
  }
  return { done, failed }
}
