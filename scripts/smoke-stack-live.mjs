// Smoke test for the stack-live Edge Function (plotline.fit's "Run a stack" page, T29.5) on the LOCAL stack:
// npm run smoke:stacklive. Needs `npx supabase start` and `npx supabase functions serve` (or the stack's function runtime).
// POSTs to /functions/v1/stack-live with the publishable key, then publishes and reads the stack back through
// publish_live_stack / get_live_stack, and checks a wrong secret and an invalid body.
// Turnstile: with TURNSTILE_SECRET_KEY unset locally the token check is skipped, so the bad-token refusal (403
// bot_check_failed) can't be proven here; it is covered by the unit tests of verifyTurnstile in
// supabase/functions/_shared/siteHttp.test.ts.
// Clean up: the stack this script creates is deleted at the end with psql (delete from public.live_stacks where code = <code>),
// as smoke:livestack does, even when a check fails.
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
const post = (body) => fetch(`${URL}/functions/v1/stack-live`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
const client = createClient(URL, KEY, { auth: { persistSession: false } })

let code
try {
  const r = await post({ turnstileToken: 'smoke-token', courts: 2, title: 'E2E smoke stack' })
  code = r.body?.code
  const secret = r.body?.secret
  check('a valid request is 200 with ok, code and secret',
    r.status === 200 && r.body?.ok === true && /^[A-Za-z0-9_-]{22,}$/.test(code ?? '') && (secret?.length ?? 0) >= 40, JSON.stringify(r))

  if (code && secret) {
    const snapshot = { v: 1 }
    const pub = await client.rpc('publish_live_stack', { p_code: code, p_secret: secret, p_version: 1, p_snapshot: snapshot })
    check('the returned secret publishes', !pub.error && pub.data?.version === 1, JSON.stringify(pub.error))
    const read = await client.rpc('get_live_stack', { p_code: code })
    check('get_live_stack returns that snapshot', JSON.stringify(read.data?.snapshot) === JSON.stringify(snapshot), JSON.stringify(read.error ?? read.data))
    check('the stack has title, courts and venue null', read.data?.venue === null && read.data?.courts === 2 && read.data?.title === 'E2E smoke stack', JSON.stringify(read.data))
    const bad = await client.rpc('publish_live_stack', { p_code: code, p_secret: 'wrong', p_version: 2, p_snapshot: snapshot })
    check('a wrong secret is refused with forbidden', bad.error?.hint === 'forbidden', JSON.stringify(bad.error))
  }

  const zero = await post({ turnstileToken: 'smoke-token', courts: 0 })
  check('courts 0 is 400 invalid_input', zero.status === 400 && zero.body?.ok === false && zero.body?.error === 'invalid_input', JSON.stringify(zero))
  const long = await post({ turnstileToken: 'smoke-token', courts: 2, title: 'x'.repeat(61) })
  check('a 61-character title is 400 invalid_input', long.status === 400 && long.body?.error === 'invalid_input', JSON.stringify(long))
} finally {
  if (code) psql(`delete from public.live_stacks where code = '${String(code).replace(/'/g, '')}';`)
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll stack-live checks passed')
process.exit(failed ? 1 : 0)
