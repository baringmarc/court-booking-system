// Leak check (H14): a spec file must leave no `e2e-*` venue and no open file-cleanup row that it created.
// Global teardown still sweeps up afterwards; this makes the leaking file fail by name instead of breaking a later flow.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from '@playwright/test'
import { serviceClient } from './helpers.ts'

/** Ids in `current` that are not in `before`: what a file created and did not remove. */
export function newIds(before: ReadonlySet<string>, current: readonly string[]) {
  return current.filter((id) => !before.has(id))
}

async function e2eVenueSlugs() {
  const { data, error } = await serviceClient().from('venues').select('id, slug').like('slug', 'e2e-%')
  if (error) throw error
  return new Map((data ?? []).map((v) => [v.id, v.slug]))
}

/** Ids of unfinished rows in the private cleanup queue (out of the API's reach, so through psql in the LOCAL db container). */
function openCleanupRows() {
  const projectId = readFileSync('supabase/config.toml', 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1]
  if (!projectId) throw new Error('Could not determine the local Supabase project id')
  const out = execFileSync('sh', ['scripts/with-docker.sh', 'docker', 'exec', `supabase_db_${projectId}`, 'psql', '-X', '-At', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-c', "select id from private.venue_file_cleanup where status <> 'done'"], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return out.split('\n').filter(Boolean)
}

/**
 * Call once at the BOTTOM of a spec file, after its own `afterAll` cleanup: Playwright runs `afterAll` hooks in the order
 * they are declared, so an earlier call would check before the cleanup ran. Rows that existed before the file started
 * (a killed run's leftovers) are not blamed on it; finished queue rows are normal and global teardown clears them.
 */
export function guardLeaks() {
  let venuesBefore = new Set<string>()
  let queueBefore = new Set<string>()

  test.beforeAll(async () => {
    venuesBefore = new Set((await e2eVenueSlugs()).keys())
    queueBefore = new Set(openCleanupRows())
  })

  test.afterAll(async () => {
    const venues = await e2eVenueSlugs()
    const leakedVenues = newIds(venuesBefore, [...venues.keys()]).map((id) => venues.get(id))
    const leakedRows = newIds(queueBefore, openCleanupRows())
    const problems = [
      ...(leakedVenues.length ? [`${leakedVenues.length} e2e venue(s) left behind: ${leakedVenues.join(', ')}`] : []),
      ...(leakedRows.length ? [`${leakedRows.length} open private.venue_file_cleanup row(s) left behind: ${leakedRows.join(', ')}`] : []),
    ]
    if (problems.length) throw new Error(`${test.info().file.split('/').pop()} leaked data. ${problems.join('; ')}`)
  })
}
