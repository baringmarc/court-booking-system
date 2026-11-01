// T16.2: restores a decrypted backup into STAGING and compares row counts with the ones recorded at dump time.
// Usage: node scripts/restore-check.mjs <extracted-backup-dir> --yes
//   Get the directory with: age -d -i key.txt backup.tar.age | tar -x -C <dir>
//   RESTORE_DB_URL  Session-pooler (or direct) URL of the STAGING project. Refused if it names production.
// Wipes the staging public, private, auth and storage schemas first (hence --yes). Needs pg_restore and psql 17.
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

// --clean --if-exists drops each object before recreating it, so staging ends up as production was.
run('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--dbname', url, join(dir, 'db.dump')])

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
