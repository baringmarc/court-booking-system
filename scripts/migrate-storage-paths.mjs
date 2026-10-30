// T12.7: copies legacy storage objects to `{venue_id}/<old path>` and points the stored paths at the copies.
// Touches court_photos.path (venue-media), venue_settings.banner_path (venue-media) and
// venue_payment_accounts.qr_path (payment-qr). Old objects stay until the contract migration (T12.11), so the
// deployed frontend keeps working. Idempotent: rows already under their venue id are skipped; an existing copy is reused.
//
// Local (default):  node scripts/migrate-storage-paths.mjs
// Linked project:   MIGRATE_URL=https://<ref>.supabase.co MIGRATE_SECRET_KEY=<service key> node scripts/migrate-storage-paths.mjs --remote
// Old objects:      add --remove-legacy (after T12.11) to delete them instead of copying.
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const remote = process.argv.includes('--remote')
let url, key
if (remote) {
  url = process.env.MIGRATE_URL
  key = process.env.MIGRATE_SECRET_KEY
  if (!url || !key) {
    console.error('--remote needs MIGRATE_URL and MIGRATE_SECRET_KEY in the environment.')
    process.exit(1)
  }
} else {
  const env = Object.fromEntries(
    execSync('sh scripts/with-docker.sh npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .map((line) => line.match(/^([A-Z_]+)="?([^"]*)"?$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  )
  url = env.API_URL
  key = env.SECRET_KEY
  if (!url?.startsWith('http://127.0.0.1') || !key) {
    console.error('Local Supabase stack not running. Start it with: npx supabase start')
    process.exit(1)
  }
}
const sb = createClient(url, key, { auth: { persistSession: false } })

const ok = (r) => {
  if (r.error) throw r.error
  return r.data
}
const venue = ok(await sb.from('venues').select('id').eq('slug', 'claudex-courts').single())
const prefix = `${venue.id}/`
let moved = 0
let failed = 0

async function move(bucket, table, column, idColumn, rows) {
  for (const row of rows) {
    const old = row[column]
    if (!old || old.startsWith(prefix)) continue
    const next = prefix + old
    try {
      const { error } = await sb.storage.from(bucket).copy(old, next)
      if (error && !/already exists|Duplicate/i.test(error.message)) throw error
      ok(await sb.from(table).update({ [column]: next }).eq(idColumn, row[idColumn]))
      moved++
      console.log(`${bucket}: ${old} -> ${next}`)
    } catch (e) {
      failed++
      console.error(`${bucket}: ${old} failed: ${e.message}`)
    }
  }
}

// --remove-legacy (T12.11, after the contract migration): deletes the old objects outside any `{venue_id}/` folder.
// The path checks now require the prefix, so no row can point at them. Refuses while a stored path is unprefixed.
if (process.argv.includes('--remove-legacy')) {
  const unprefixed = [
    ...ok(await sb.from('court_photos').select('path')).map((r) => r.path),
    ...ok(await sb.from('venue_settings').select('banner_path')).map((r) => r.banner_path),
    ...ok(await sb.from('venue_payment_accounts').select('qr_path')).map((r) => r.qr_path),
  ].filter((p) => p && !/^[0-9a-f-]{36}\//.test(p))
  if (unprefixed.length) {
    console.error(`Refusing: ${unprefixed.length} stored paths are not under a venue folder. Run the copy first.`)
    process.exit(1)
  }
  const isVenueFolder = (name) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(name)
  // Every file under `folder`, recursively (folders are listed with a null id).
  const files = async (bucket, folder) => {
    const out = []
    for (const e of ok(await sb.storage.from(bucket).list(folder, { limit: 1000 }))) {
      const path = folder ? `${folder}/${e.name}` : e.name
      if (e.id === null) out.push(...(await files(bucket, path)))
      else out.push(path)
    }
    return out
  }
  let removed = 0
  for (const bucket of ['venue-media', 'payment-qr']) {
    for (const e of ok(await sb.storage.from(bucket).list('', { limit: 1000 }))) {
      if (e.id === null && isVenueFolder(e.name)) continue
      const legacy = e.id === null ? await files(bucket, e.name) : [e.name]
      if (!legacy.length) continue
      ok(await sb.storage.from(bucket).remove(legacy))
      removed += legacy.length
      console.log(`${bucket}: removed ${legacy.length} under ${e.name}`)
    }
  }
  console.log(`removed ${removed} legacy objects`)
  process.exit(0)
}

await move('venue-media', 'court_photos', 'path', 'id', ok(await sb.from('court_photos').select('id, path')))
await move('venue-media', 'venue_settings', 'banner_path', 'venue_id', ok(await sb.from('venue_settings').select('venue_id, banner_path')))
await move('payment-qr', 'venue_payment_accounts', 'qr_path', 'id', ok(await sb.from('venue_payment_accounts').select('id, qr_path')))
console.log(`moved ${moved}, failed ${failed}`)
process.exit(failed ? 1 : 0)
