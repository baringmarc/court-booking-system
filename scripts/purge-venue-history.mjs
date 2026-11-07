// T17.29: the one-off, separately reviewed cleanup of test venues' history (supabase/functions/_shared/venueHistoryPurge.ts).
// Every step reads a reviewed manifest JSON (kept outside the repo); none deletes anything the manifest doesn't list.
//
//   node scripts/purge-venue-history.mjs backup-sql <manifest.json> <out.sql>   one select: every row about to be removed
//   node scripts/purge-venue-history.mjs sql <manifest.json> <out.sql>          one do block: re-check, then remove the history
//   PURGE_URL=https://<ref>.supabase.co PURGE_SECRET_KEY=<service key> \
//     node scripts/purge-venue-history.mjs files <manifest.json> <backup-dir> [--remove-proofs]
//       downloads each venue's venue-media/payment-qr files and its proof files into <backup-dir>; with --remove-proofs
//       (after the purge) removes the proof files through the Storage API.
//
// Run the generated SQL with `npx supabase db query --linked -f <out.sql>`. The sql steps refuse unless the CLI is linked
// to the manifest's project_ref. Afterwards each venue is deleted with the console's Delete venue, which removes its files.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { PROOF_BUCKET, backupSql, purgeSql, removeProofFiles, validateManifest } from '../supabase/functions/_shared/venueHistoryPurge.ts'
import { CLEANUP_BUCKETS, filesUnder, storageAdapter } from '../supabase/functions/_shared/venueCleanup.ts'

const [command, manifestPath, out] = process.argv.slice(2)
const usage = 'usage: purge-venue-history.mjs backup-sql|sql <manifest.json> <out.sql> | files <manifest.json> <backup-dir> [--remove-proofs]'
if (!command || !manifestPath || !out) {
  console.error(usage)
  process.exit(1)
}
const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
const repo = resolve(dirname(new URL(import.meta.url).pathname), '..')

if (command === 'sql' || command === 'backup-sql') {
  const refFile = join(repo, 'supabase/.temp/project-ref')
  const linked = existsSync(refFile) ? readFileSync(refFile, 'utf8').trim() : ''
  if (linked !== manifest.project_ref) {
    console.error(`The CLI is linked to "${linked}", but the manifest is for "${manifest.project_ref}". Link the right project first.`)
    process.exit(1)
  }
  writeFileSync(out, command === 'sql' ? purgeSql(manifest) : backupSql(manifest))
  console.log(`Wrote ${out} for ${manifest.project_ref}: ${manifest.venues.map((v) => v.slug).join(', ')}`)
} else if (command === 'files') {
  const url = process.env.PURGE_URL
  const key = process.env.PURGE_SECRET_KEY
  if (!url || !key) {
    console.error('files needs PURGE_URL and PURGE_SECRET_KEY in the environment.')
    process.exit(1)
  }
  const host = new URL(url).hostname
  const local = manifest.project_ref === 'local' && host === '127.0.0.1' // a local rehearsal
  if (!local && host !== `${manifest.project_ref}.supabase.co`) {
    console.error(`PURGE_URL is not the manifest's project (${manifest.project_ref}).`)
    process.exit(1)
  }
  const backupDir = resolve(out)
  if (backupDir === repo || backupDir.startsWith(`${repo}/`)) {
    console.error('Keep the backup outside the repository: it holds payment proofs.')
    process.exit(1)
  }
  const service = createClient(url, key, { auth: { persistSession: false } })
  const storage = storageAdapter(service)
  const wanted = manifest.venues.flatMap((v) => v.proof_files.map((path) => [PROOF_BUCKET, path]))
  for (const v of manifest.venues) {
    for (const bucket of CLEANUP_BUCKETS) for (const path of await filesUnder(storage, bucket, v.venue_id)) wanted.push([bucket, path])
  }
  for (const [bucket, path] of wanted) {
    const target = join(backupDir, bucket, path)
    if (existsSync(target)) continue
    const { data, error } = await service.storage.from(bucket).download(path)
    if (error) throw new Error(`download ${bucket}/${path}: ${error.message}`)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, Buffer.from(await data.arrayBuffer()))
  }
  console.log(`Backed up ${wanted.length} files to ${backupDir}`)

  if (process.argv.includes('--remove-proofs')) {
    const isReferenced = async (path) => {
      const { count, error } = await service.from('payments').select('id', { count: 'exact', head: true }).eq('storage_path', path)
      if (error) throw new Error(`check payments for ${path}: ${error.message}`)
      return (count ?? 0) > 0
    }
    const { removed } = await removeProofFiles(storage, manifest, isReferenced)
    console.log(`Removed ${removed.length} proof files: ${removed.join(', ') || 'none'}`)
  }
} else {
  console.error(usage)
  process.exit(1)
}
