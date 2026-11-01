// T16.2: restores a decrypted backup into a disposable database (local Supabase Postgres or staging) and compares
// row counts with the ones recorded at dump time.
// Usage: node scripts/restore-check.mjs <extracted-backup-dir> --yes
//   Get the directory with: age -d -i key.txt backup.tar.age | tar -x -C <dir>
//   RESTORE_DB_URL  e.g. postgresql://postgres:postgres@127.0.0.1:54322/postgres for the local stack. Refused if it
//                   names production.
// Wipes the target's auth users and its public and private schemas (hence --yes). Needs pg_restore and psql.
// Supabase owns the rest of the auth and storage schemas, so only auth.users and auth.identities (data) and the
// public and private schemas are restored; the row counts are the proof, the object-level errors are not.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertRestoreTarget, diffRowCounts } from '../supabase/functions/_shared/backup.ts'

const dir = process.argv[2]
const url = process.env.RESTORE_DB_URL ?? ''
if (!dir || !process.argv.includes('--yes')) {
  console.error('Usage: RESTORE_DB_URL=<staging url> node scripts/restore-check.mjs <extracted-backup-dir> --yes')
  process.exit(1)
}
assertRestoreTarget(url)
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })

// pg_restore exits non-zero on any ignored error (Supabase-owned objects, for one), so its exit code is not used.
function restore(args) {
  try {
    run('pg_restore', ['--no-owner', '--no-privileges', '--dbname', url, ...args, join(dir, 'db.dump')])
  } catch {
    console.warn('pg_restore reported errors (see above); the row counts below decide.')
  }
}
// Users first, because public tables reference auth.users.
run('psql', [url, '-At', '-c', 'truncate auth.users cascade'])
restore(['--data-only', '--schema=auth', '--table=users', '--table=identities'])
// --clean --if-exists drops each object before recreating it, so the target ends up as production was.
restore(['--clean', '--if-exists', '--schema=public', '--schema=private'])

const expected = JSON.parse(readFileSync(join(dir, 'counts.json'), 'utf8'))
const actual = {}
for (const table of Object.keys(expected)) {
  actual[table] = Number(run('psql', [url, '-At', '-c', `select count(*) from public."${table}"`]).trim())
}
const diffs = diffRowCounts(expected, actual)
if (diffs.length) {
  console.error('Row counts differ after restore:')
  console.table(diffs)
  process.exit(1)
}
console.log(`Restore OK: ${Object.keys(expected).length} tables match`)
