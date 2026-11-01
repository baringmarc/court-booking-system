// Smoke test for the site-contact Edge Function (the marketing site's contact form).
// Local (default): npm run smoke:contact. Needs `npx supabase start`; checks the lead lands in `leads`, then removes it.
// Hosted: npm run smoke:contact -- --hosted [--origin https://plotline.fit]. Uses VITE_SUPABASE_URL and the publishable
// key from .env, and sends a Turnstile token you pass with --token (any string works with Cloudflare's dummy secret
// 1x0000000000000000000000000000000AA). It cannot read `leads` (platform admins only), so it prints the e2e email to
// delete afterwards with:  npx supabase db query --linked "delete from leads where email like 'e2e-contact-%@example.com'"
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const hosted = args.includes('--hosted')
const origin = flag('--origin') ?? 'https://plotline.fit'
const token = flag('--token') ?? 'smoke-token'

let URL, KEY, service
if (hosted) {
  const dotenv = Object.fromEntries(
    readFileSync('.env', 'utf8').split('\n').map((l) => l.match(/^(?:export\s+)?([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim().replace(/^(["'])(.*)\1$/, '$2')]),
  )
  URL = dotenv.VITE_SUPABASE_URL
  KEY = dotenv.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!URL?.startsWith('https://') || !KEY) { console.error('.env needs VITE_SUPABASE_URL (https) and VITE_SUPABASE_PUBLISHABLE_KEY'); process.exit(1) }
} else {
  const env = Object.fromEntries(
    execSync('sh scripts/with-docker.sh npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map((l) => l.match(/^([A-Z_]+)="?([^"]*)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
  )
  URL = env.API_URL
  KEY = env.PUBLISHABLE_KEY
  if (!URL?.startsWith('http://127.0.0.1') || !KEY || !env.SECRET_KEY) {
    console.error('Local Supabase stack not running (or not local). Start it with: npx supabase start')
    process.exit(1)
  }
  service = createClient(URL, env.SECRET_KEY, { auth: { persistSession: false } })
}

const tag = Date.now().toString(36)
let failed = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`); if (!ok) failed++ }

const form = (over = {}) => ({
  firstName: 'Smoke', lastName: 'Test', email: `e2e-contact-${tag}@example.com`, phone: '09171234567',
  venueName: `E2E Courts ${tag}`, location: 'Cebu City', courts: 4, consent: true,
  website: '', started: Date.now() - 10_000, turnstileToken: token, ...over,
})
const post = (body, headers = {}) => fetch(`${URL}/functions/v1/site-contact`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}`, ...(hosted ? { Origin: origin } : {}), ...headers },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, cors: r.headers.get('access-control-allow-origin'), body: await r.json().catch(() => null) }))
const leadCount = async (email) => {
  if (!service) return null
  const { count } = await service.from('leads').select('id', { count: 'exact', head: true }).eq('email', email)
  return count
}

try {
  const okForm = form()
  const r1 = await post(okForm)
  check('a valid form is accepted', r1.status === 200 && r1.body?.ok === true, JSON.stringify(r1))
  if (hosted) check('the allowed origin is echoed back', r1.cors === origin, String(r1.cors))
  const stored = await leadCount(okForm.email)
  if (!hosted) check('the lead is stored', stored === 1, String(stored))
  if (!hosted) {
    const alerts = (email) => fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`subject:"New lead" ${email}`)}`)
      .then((r) => r.json()).then((j) => j.messages?.length ?? 0).catch(() => -1)
    await new Promise((r) => setTimeout(r, 500))
    check('the lead alert reached Mailpit (needs LEAD_ALERT_TO in supabase/functions/.env and a stack restart)', (await alerts(okForm.venueName)) === 1)
  }

  const r2 = await post(form({ email: 'not-an-email' }))
  check('an invalid form is 400', r2.status === 400 && r2.body?.ok === false, JSON.stringify(r2))

  const botEmail = `e2e-contact-bot-${tag}@example.com`
  const r3 = await post(form({ email: botEmail, website: 'http://spam.example' }))
  check('a filled honeypot gets the fake success', r3.status === 200 && r3.body?.ok === true, JSON.stringify(r3))
  const r4 = await post(form({ email: botEmail, started: Date.now() }))
  check('a too-fast form gets the fake success', r4.status === 200 && r4.body?.ok === true, JSON.stringify(r4))
  if (!hosted) check('bots store nothing', (await leadCount(botEmail)) === 0)
  if (!hosted) check('bots and invalid forms send no alert', (await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`subject:"New lead" ${botEmail}`)}`).then((r) => r.json()).then((j) => j.messages?.length ?? 0)) === 0)

  if (hosted) {
    const r5 = await post(form({ email: `e2e-contact-origin-${tag}@example.com` }), { Origin: 'https://evil.example' })
    check('an origin outside SITE_ORIGINS gets no CORS header', r5.cors === null, String(r5.cors))
  }
} finally {
  if (service) await service.from('leads').delete().like('email', `e2e-contact-%${tag}%@example.com`)
}

if (hosted) console.log(`\nDelete the hosted test leads:\n  npx supabase db query --linked "delete from leads where email like 'e2e-contact-%@example.com'"`)
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
