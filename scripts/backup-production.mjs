// T16.2: nightly production backup. Run by .github/workflows/backup.yml (needs pg_dump 17, psql, age and the
// aws CLI on the PATH). Dumps the data schemas over the Session pooler, copies the Storage buckets, writes row
// counts for the restore check, encrypts everything with age and uploads it to a private R2 bucket, then deletes
// backups older than 14 days. The vault schema (secrets) is not dumped.
//
//   BACKUP_DB_URL        Session-pooler URL of production (postgresql://postgres.<ref>:<password>@...:5432/postgres)
//   BACKUP_SUPABASE_URL  https://<ref>.supabase.co
//   BACKUP_SERVICE_KEY   production service-role (secret) key, used to download Storage objects
//   AGE_RECIPIENT        age public key (age1...). The private key stays offline with the owner.
//   R2_ENDPOINT, R2_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   Cloudflare R2 (S3 API) credentials
//   --dry-run            build the encrypted archive in a temp dir but do not upload or prune
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { backupKey, expiredKeys } from '../supabase/functions/_shared/backup.ts'

const dryRun = process.argv.includes('--dry-run')
const need = ['BACKUP_DB_URL', 'BACKUP_SUPABASE_URL', 'BACKUP_SERVICE_KEY', 'AGE_RECIPIENT']
if (!dryRun) need.push('R2_ENDPOINT', 'R2_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY')
const missing = need.filter((name) => !process.env[name])
if (missing.length) {
  console.error(`Missing environment: ${missing.join(', ')}`)
  process.exit(1)
}
const env = process.env
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts })

const work = mkdtempSync(join(tmpdir(), 'plotline-backup-'))
const dataDir = join(work, 'archive')
mkdirSync(join(dataDir, 'storage'), { recursive: true })

// 1. Database dump (custom format, restorable with pg_restore).
run('pg_dump', [
  '--format=custom', '--no-owner', '--no-privileges',
  '--schema=public', '--schema=private', '--schema=auth', '--schema=storage',
  `--file=${join(dataDir, 'db.dump')}`, env.BACKUP_DB_URL,
])

// 2. Row counts of every public table, for the restore check.
const tables = run('psql', [env.BACKUP_DB_URL, '-At', '-c', "select tablename from pg_tables where schemaname = 'public' order by 1"])
  .split('\n').filter(Boolean)
const counts = {}
for (const table of tables) {
  counts[table] = Number(run('psql', [env.BACKUP_DB_URL, '-At', '-c', `select count(*) from public."${table}"`]).trim())
}
writeFileSync(join(dataDir, 'counts.json'), JSON.stringify(counts, null, 2))

// 3. Storage objects (a database dump omits them).
const sb = createClient(env.BACKUP_SUPABASE_URL, env.BACKUP_SERVICE_KEY, { auth: { persistSession: false } })
async function listFiles(bucket, folder = '') {
  const limit = 1000
  const out = []
  for (let offset = 0; ; offset += limit) {
    const { data, error } = await sb.storage.from(bucket).list(folder, { limit, offset })
    if (error) throw error
    for (const entry of data) {
      const path = folder ? `${folder}/${entry.name}` : entry.name
      if (entry.id === null) out.push(...(await listFiles(bucket, path)))
      else out.push(path)
    }
    if (data.length < limit) return out
  }
}
let objects = 0
for (const bucket of ['venue-media', 'payment-qr', 'platform-billing']) {
  for (const path of await listFiles(bucket)) {
    const { data, error } = await sb.storage.from(bucket).download(path)
    if (error) throw new Error(`${bucket}/${path}: ${error.message}`)
    const file = join(dataDir, 'storage', bucket, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, Buffer.from(await data.arrayBuffer()))
    objects++
  }
}

// 4. Archive and encrypt.
const archive = join(work, 'backup.tar.age')
const tar = join(work, 'backup.tar')
run('tar', ['-cf', tar, '-C', dataDir, '.'])
run('age', ['-r', env.AGE_RECIPIENT, '-o', archive, tar])
console.log(`Archive ready: ${tables.length} tables, ${objects} storage objects`)

if (dryRun) {
  console.log(`Dry run: not uploaded. Archive at ${archive}`)
  process.exit(0)
}

// 5. Upload, then prune.
const aws = (...args) => run('aws', ['--endpoint-url', env.R2_ENDPOINT, '--region', 'auto', ...args])
const now = new Date()
const key = backupKey(now)
aws('s3', 'cp', archive, `s3://${env.R2_BUCKET}/${key}`)
console.log(`Uploaded ${key}`)
const listed = JSON.parse(aws('s3api', 'list-objects-v2', '--bucket', env.R2_BUCKET, '--prefix', 'backups/', '--output', 'json') || '{}')
for (const old of expiredKeys((listed.Contents ?? []).map((o) => o.Key), now)) {
  aws('s3', 'rm', `s3://${env.R2_BUCKET}/${old}`)
  console.log(`Deleted ${old}`)
}
