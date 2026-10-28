// CORS, JSON and Turnstile helpers for the marketing site's public Edge Functions (`site-contact`, `site-review`).
//
// SITE_ORIGINS: the allowed origins, comma-separated (e.g. "https://plotline.fit,https://www.plotline.fit").
// When it isn't set, only a local stack (http SUPABASE_URL) answers with '*'; a hosted project refuses
// cross-origin calls, so a missing secret fails closed.

type Env = { get(key: string): string | undefined }

function env(): Env | undefined {
  return (globalThis as { Deno?: { env: Env } }).Deno?.env
}

export function isLocalStack(): boolean {
  return (env()?.get('SUPABASE_URL') ?? '').startsWith('http://')
}

function allowedOrigin(req: Request): string | null {
  const list = (env()?.get('SITE_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean)
  if (list.length === 0) return isLocalStack() ? '*' : null
  const origin = req.headers.get('origin') ?? ''
  return list.includes(origin) ? origin : null
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = allowedOrigin(req)
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

/** Answers preflight and wrong methods; returns null when the request should be handled. */
export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { ok: false, error: 'Method not allowed.' }, 405)
  return null
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return null
  }
}

/**
 * Checks a Cloudflare Turnstile token with TURNSTILE_SECRET_KEY.
 * - Local stack without the secret: skipped (true), so local dev and e2e work without Cloudflare.
 * - Hosted project without the secret: 'unconfigured', so the caller answers 503 instead of letting bots in.
 */
export async function verifyTurnstile(token: unknown, req: Request): Promise<boolean | 'unconfigured'> {
  const secret = env()?.get('TURNSTILE_SECRET_KEY')
  if (!secret) return isLocalStack() ? true : 'unconfigured'
  if (typeof token !== 'string' || token === '' || token.length > 2048) return false

  const form = new FormData()
  form.append('secret', secret)
  form.append('response', token)
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (ip) form.append('remoteip', ip)

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
    if (!res.ok) return false
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}
