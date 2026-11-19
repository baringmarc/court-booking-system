// POST /functions/v1/stack-live: an organizer at plotline.fit goes live with a Paddle Stack without signing in (T29.5).
// Contract: docs/PLATFORM.md §4 "Live stacks". Checks the origin (SITE_ORIGINS) and Turnstile, then creates a stack
// with no venue through create_site_live_stack (service role only) and returns {code, secret}. The secret is
// returned once; only its hash is stored. Logs never hold the title, the code or the secret.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { json, preflight, readJson, verifyTurnstile } from '../_shared/siteHttp.ts'
import { parseStackLiveBody, stackLiveFailure } from '../_shared/stackLive.ts'
import * as Sentry from 'npm:@sentry/deno@10.76.2'
import { withSentry } from '../_shared/sentry.ts'

Deno.serve(withSentry('stack-live', async (req) => {
  const early = preflight(req)
  if (early) return early

  const body = await readJson(req)
  const parsed = parseStackLiveBody(body)
  if (!parsed.ok) return json(req, { ok: false, error: 'invalid_input' }, 400)

  const human = await verifyTurnstile((body as { turnstileToken?: unknown }).turnstileToken, req)
  if (human === 'unconfigured') {
    console.error('stack-live: TURNSTILE_SECRET_KEY is not set on a hosted project')
    return json(req, { ok: false, error: 'unavailable' }, 503)
  }
  if (!human) return json(req, { ok: false, error: 'bot_check_failed' }, 403)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await admin.rpc('create_site_live_stack', { p_title: parsed.title, p_courts: parsed.courts })
  if (error) {
    const failure = stackLiveFailure(error.hint)
    if (failure.status === 500) console.error('stack-live: create failed', error.code)
    return json(req, { ok: false, error: failure.error }, failure.status)
  }
  const { code, secret } = data as { code: string; secret: string }
  return json(req, { ok: true, code, secret })
}, Sentry))
