#!/usr/bin/env node
// H20: runs each named pgTAP file once against the LOCAL Supabase database and says whether it is broken or only red.
//
//   npm run test:db:check -- supabase/tests/database/91_new_venues_active.test.sql [more files…]
//
// Per file it prints "planned N, ran M, failed K", the first failing assertion names, and why a file is broken.
// Exit 1 only when a file is broken (no plan, a plan mismatch, an SQL error); `not ok`
// assertions alone exit 0. Exit 2 on a usage error or when the local database can't be reached.
// Read-only: each file runs in its own transaction and ends with `rollback`; it applies no migrations
// (`npm run test:db` does). The npm script wraps it in scripts/with-lock.mjs and scripts/with-docker.sh.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { parseTapRun, formatFileReport, exitCodeFor } from './lib/pgtap-check.mjs'

const CONTAINER = 'supabase_db_court-booking-system'
const files = process.argv.slice(2)

if (files.length === 0) {
  console.error('Usage: npm run test:db:check -- <pgTAP file…>')
  process.exit(2)
}
const missing = files.filter((f) => !existsSync(f))
if (missing.length) {
  console.error(`No such file: ${missing.join(', ')}`)
  process.exit(2)
}

const results = []
for (const file of files) {
  const run = spawnSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=0'],
    { input: readFileSync(file), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  if (run.error || run.status !== 0) {
    // psql with ON_ERROR_STOP=0 exits 0 even when statements fail; non-zero means no database at all.
    console.error(`Could not run ${file} on the local database (${CONTAINER}). Is it up? npx supabase start`)
    console.error((run.error?.message ?? run.stderr ?? '').trim())
    process.exit(2)
  }
  const result = parseTapRun({ stdout: run.stdout, stderr: run.stderr })
  results.push(result)
  console.log(formatFileReport(file, result))
}

const broken = results.filter((r) => r.broken).length
console.log(
  broken
    ? `PGTAP CHECK FAILED: ${broken} of ${results.length} file(s) broken (fix the file, not the behavior).`
    : `PGTAP CHECK PASSED: ${results.length} file(s) run; any not ok lines are red assertions, not broken files.`,
)
process.exit(exitCodeFor(results))
