// T12.7: copies legacy storage objects to `{venue_id}/<old path>` and points the stored paths at the copies.
// Touches court_photos.path (venue-media), venue_settings.banner_path (venue-media) and
// venue_payment_accounts.qr_path (payment-qr). Old objects stay until the contract migration (T12.11), so the
// deployed frontend keeps working. Idempotent: rows already under their venue id are skipped; an existing copy is reused.
//
// Local (default):  node scripts/migrate-storage-paths.mjs
// Linked project:   MIGRATE_URL=https://<ref>.supabase.co MIGRATE_SECRET_KEY=<service key> node scripts/migrate-storage-paths.mjs --remote
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

await move('venue-media', 'court_photos', 'path', 'id', ok(await sb.from('court_photos').select('id, path')))
await move('venue-media', 'venue_settings', 'banner_path', 'venue_id', ok(await sb.from('venue_settings').select('venue_id, banner_path')))
await move('payment-qr', 'venue_payment_accounts', 'qr_path', 'id', ok(await sb.from('venue_payment_accounts').select('id, qr_path')))
console.log(`moved ${moved}, failed ${failed}`)
process.exit(failed ? 1 : 0)
