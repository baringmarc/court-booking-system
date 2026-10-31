// T14.2: CORS allow-list, preflight and Turnstile fallbacks of the marketing-site helpers (no Deno needed).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { json, preflight, verifyTurnstile } from './siteHttp.ts'

const HOSTED = 'https://abc.supabase.co'
const LOCAL = 'http://kong:8000'

function setEnv(vars: Record<string, string>) {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => vars[k] } }
}
function req(method: string, origin?: string) {
  return new Request('https://x.test/fn', { method, headers: origin ? { origin } : {} })
}

afterEach(() => {
  delete (globalThis as { Deno?: unknown }).Deno
  vi.restoreAllMocks()
})

describe('CORS origin allow-list (SITE_ORIGINS)', () => {
  it('echoes an allowed origin and refuses others', () => {
    setEnv({ SUPABASE_URL: HOSTED, SITE_ORIGINS: 'https://plotline.fit, https://www.plotline.fit' })
    expect(json(req('POST', 'https://www.plotline.fit'), {}).headers.get('Access-Control-Allow-Origin')).toBe('https://www.plotline.fit')
    expect(json(req('POST', 'https://evil.example'), {}).headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('fails closed on a hosted project without SITE_ORIGINS', () => {
    setEnv({ SUPABASE_URL: HOSTED })
    expect(json(req('POST', 'https://plotline.fit'), {}).headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('answers * on a local stack without SITE_ORIGINS', () => {
    setEnv({ SUPABASE_URL: LOCAL })
    expect(json(req('POST', 'http://localhost:5173'), {}).headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

describe('preflight', () => {
  it('answers OPTIONS with 200 and CORS headers, and rejects GET with 405', async () => {
    setEnv({ SUPABASE_URL: LOCAL })
    const options = preflight(req('OPTIONS'))
    expect(options?.status).toBe(200)
    expect(options?.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    const get = preflight(req('GET'))
    expect(get?.status).toBe(405)
    expect(await get?.json()).toEqual({ ok: false, error: 'Method not allowed.' })
  })

  it('lets a POST through', () => {
    setEnv({ SUPABASE_URL: LOCAL })
    expect(preflight(req('POST'))).toBeNull()
  })
})

describe('verifyTurnstile', () => {
  it('is unconfigured on a hosted URL without the secret', async () => {
    setEnv({ SUPABASE_URL: HOSTED })
    expect(await verifyTurnstile('tok', req('POST'))).toBe('unconfigured')
  })

  it('is skipped (true) on a local http URL without the secret', async () => {
    setEnv({ SUPABASE_URL: LOCAL })
    expect(await verifyTurnstile(undefined, req('POST'))).toBe(true)
  })

  it('rejects a missing token when the secret is set, and accepts a verified one', async () => {
    setEnv({ SUPABASE_URL: HOSTED, TURNSTILE_SECRET_KEY: 's' })
    expect(await verifyTurnstile('', req('POST'))).toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }))))
    expect(await verifyTurnstile('tok', req('POST'))).toBe(true)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false }))))
    expect(await verifyTurnstile('tok', req('POST'))).toBe(false)
    vi.unstubAllGlobals()
  })
})
