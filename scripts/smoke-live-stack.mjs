// Smoke test for live stacks (T29.4) on the LOCAL stack: npm run smoke:livestack. Needs `npx supabase start`.
// Creates a stack with private.create_live_stack (as postgres, since stack-live arrives in T29.5), joins its public
// channel live-stack:<code> as an anon viewer, publishes through publish_live_stack with the publishable key and checks
// the viewer receives {version, snapshot, ended} as event 'snapshot'; then reads it back with get_live_stack and
// deletes the stack. Right after `npm run db:reset:local` the first run can miss the broadcast while Realtime
// reconnects to the database (seen once on 2026-11-19, then 8 runs in a row passed); run it again before suspecting it.
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  execSync('sh scripts/with-docker.sh npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').map((l) => l.match(/^([A-Z_]+)="?([^"]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
)
const URL = env.API_URL
const KEY = env.PUBLISHABLE_KEY
if (!URL?.startsWith('http://127.0.0.1') || !KEY) {
  console.error('Local Supabase stack not running (or not local). Start it with: npx supabase start')
  process.exit(1)
}
const psql = (sql) =>
  execSync(`sh scripts/with-docker.sh docker exec -i supabase_db_court-booking-system psql -U postgres -tAq -v ON_ERROR_STOP=1`, {
    input: sql, encoding: 'utf8',
  }).trim()

let failed = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`); if (!ok) failed++ }
const opts = { auth: { persistSession: false } }
const organizer = createClient(URL, KEY, opts)
const viewer = createClient(URL, KEY, opts)
const join = (client, topic) => new Promise((resolve, reject) => {
  const ch = client.channel(topic)
  const got = []
  ch.on('broadcast', { event: 'snapshot' }, ({ payload }) => got.push(payload))
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') resolve({ ch, got })
    else if (status !== 'CLOSED') reject(new Error(`subscribe: ${status}`))
  })
})
const waitFor = async (pred, ms = 5000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { if (pred()) return true; await new Promise((r) => setTimeout(r, 50)) }
  return false
}

const { code, secret } = JSON.parse(psql(`select private.create_live_stack('E2E smoke stack', 2, null, null);`))
try {
  check('a stack is created with a code and a secret', /^[A-Za-z0-9_-]{22,}$/.test(code) && secret?.length >= 40)
  // The organizer joins its own channel first (it creates today's realtime.messages partition), then a viewer.
  const own = await join(organizer, `live-stack:${code}`)
  const view = await join(viewer, `live-stack:${code}`)

  const snapshot = { v: 1, round: 1, courts: [['E2E Ana', 'E2E Ben']] }
  const pub = await organizer.rpc('publish_live_stack', { p_code: code, p_secret: secret, p_version: 1, p_snapshot: snapshot })
  check('publish_live_stack succeeds with the publishable key', !pub.error && pub.data?.version === 1, JSON.stringify(pub.error))
  const arrived = await waitFor(() => view.got.length > 0)
  check('an anon viewer receives the snapshot on live-stack:<code>', arrived)
  const p = view.got[0] ?? {}
  check('the payload is {version, snapshot, ended}', p.version === 1 && p.ended === false && JSON.stringify(p.snapshot) === JSON.stringify(snapshot), JSON.stringify(p))

  const bad = await organizer.rpc('publish_live_stack', { p_code: code, p_secret: 'wrong', p_version: 2, p_snapshot: snapshot })
  check('a wrong secret is refused with forbidden', bad.error?.hint === 'forbidden', JSON.stringify(bad.error))
  await new Promise((r) => setTimeout(r, 500))
  check('a refused publish broadcasts nothing', view.got.length === 1, `got ${view.got.length}`)

  const read = await viewer.rpc('get_live_stack', { p_code: code })
  check('get_live_stack reads it back', read.data?.version === 1 && read.data?.venue === null, JSON.stringify(read.error ?? read.data))
  const list = await viewer.from('live_stacks').select('code')
  check('the table cannot be read directly', !!list.error, JSON.stringify(list.data))

  await organizer.removeChannel(own.ch)
  await viewer.removeChannel(view.ch)
} finally {
  psql(`delete from public.live_stacks where code = '${code.replace(/'/g, '')}';`)
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll live stack checks passed')
process.exit(failed ? 1 : 0)
