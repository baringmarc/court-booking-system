// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './index'
import { PLOTLINE_ICONS } from './manifest'

const SUPABASE_URL = 'https://abcdefghijklmnop.supabase.co'
const KEY = 'sb_publishable_test_key'
const HTML = '<!doctype html><html><head><title>Plotline</title></head><body><div id="root"></div></body></html>'
const VENUE_URL = 'https://claudex-courts.plotline.fit/'
const BANNER = '11111111-1111-4111-8111-111111111111/banner/a.jpg'
const UPDATED_AT = '2026-11-20T10:15:30.123+00:00'
const LOGO = '11111111-1111-4111-8111-111111111111/logo/22222222-2222-4222-8222-222222222222.webp'
const MANIFEST_URL = 'https://claudex-courts.plotline.fit/manifest.webmanifest'
const STATIC_MANIFEST = JSON.stringify({ name: 'Plotline', short_name: 'Plotline', start_url: '/', scope: '/' })
const TOUCH_ICON = 'link[rel="apple-touch-icon"]'

type TestEnv = {
  ASSETS: { fetch: ReturnType<typeof vi.fn> }
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
}
type Ctx = { waitUntil: ReturnType<typeof vi.fn> }
type Handler = { element(el: unknown): void }

const settings = {
  name: 'Claudex Courts',
  city: 'Cebu City',
  banner_path: BANNER,
  banner_alt: 'Indoor courts at dusk',
  logo_path: null,
  sport_order: ['pickleball', 'badminton'],
  updated_at: UPDATED_AT,
  theme: 'plotline',
}
const venueRows = [{ slug: 'claudex-courts', venue_settings: settings }]

function htmlAsset(init: ResponseInit = {}) {
  return new Response(HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init })
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

function makeEnv(asset: () => Response = htmlAsset): TestEnv {
  return {
    ASSETS: { fetch: vi.fn(async () => asset()) },
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: KEY,
  }
}

function makeCtx(): Ctx {
  return { waitUntil: vi.fn() }
}

async function run(request: Request, env: TestEnv, ctx: Ctx = makeCtx()) {
  return worker.fetch(request, env as never, ctx as never)
}

// --- stubs for the Workers globals ---------------------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>
let rewriters: FakeRewriter[]
let transformed: Response[]
const REWRITTEN = 'REWRITTEN-BY-HTMLREWRITER'

class FakeRewriter {
  handlers: Array<[string, Handler]> = []
  constructor() {
    rewriters.push(this)
  }
  on(selector: string, handler: Handler) {
    this.handlers.push([selector, handler])
    return this
  }
  transform(response: Response) {
    transformed.push(response)
    return new Response(REWRITTEN, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
  handler(selector: string): Handler {
    const found = this.handlers.find(([s]) => s === selector)
    if (!found) throw new Error(`no handler registered for ${selector}`)
    return found[1]
  }
}

function fakeElement() {
  return { setInnerContent: vi.fn(), append: vi.fn() }
}

function fakeLink() {
  return { setAttribute: vi.fn() }
}

function urlOf(input: unknown) {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return (input as Request).url
}

function installCache(initial?: Map<string, Response>) {
  const store = initial ?? new Map<string, Response>()
  const match = vi.fn(async (key: unknown) => store.get(urlOf(key))?.clone())
  const put = vi.fn(async (key: unknown, response: Response) => {
    store.set(urlOf(key), response.clone())
  })
  vi.stubGlobal('caches', { default: { match, put } })
  return { store, match, put }
}

beforeEach(() => {
  rewriters = []
  transformed = []
  fetchMock = vi.fn(async () => jsonResponse(venueRows))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('HTMLRewriter', FakeRewriter)
  installCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function expectOriginalPage(response: Response) {
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('text/html')
  expect(await response.text()).toBe(HTML)
}

// --- the happy path -------------------------------------------------------------------------------------------

describe('venue page navigation', () => {
  it('asks ASSETS for the page first and rewrites it with HTMLRewriter', async () => {
    const env = makeEnv()
    const request = new Request(VENUE_URL)
    const result = await run(request, env)
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1)
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(request)
    expect(rewriters).toHaveLength(1)
    expect(transformed).toHaveLength(1)
    expect(await result.text()).toBe(REWRITTEN)
    expect(result.status).toBe(200)
  })

  it('reads the venue and its settings from Supabase with the publishable key and a timeout signal', async () => {
    await run(new Request(VENUE_URL), makeEnv())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [input, init] = fetchMock.mock.calls[0] as [unknown, RequestInit]
    const url = new URL(urlOf(input))
    expect(url.origin).toBe(SUPABASE_URL)
    expect(url.pathname).toBe('/rest/v1/venues')
    expect(url.searchParams.get('slug')).toBe('eq.claudex-courts')
    expect(url.searchParams.get('status')).toBe('eq.active')
    expect(url.searchParams.get('select')).toBe(
      'slug,venue_settings(name,city,banner_path,banner_alt,logo_path,sport_order,updated_at,theme)',
    )
    const headers = new Headers(init.headers)
    expect(headers.get('apikey')).toBe(KEY)
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect((init.method ?? 'GET').toUpperCase()).toBe('GET')
  })

  it('registers a title handler that sets the venue title', async () => {
    await run(new Request(VENUE_URL), makeEnv())
    const el = fakeElement()
    rewriters[0].handler('title').element(el)
    expect(el.setInnerContent).toHaveBeenCalledTimes(1)
    expect(el.setInnerContent).toHaveBeenCalledWith('Claudex Courts · Book a court')
  })

  it('registers a head handler that appends the meta tags as HTML', async () => {
    await run(new Request('https://claudex-courts.plotline.fit/book'), makeEnv())
    const el = fakeElement()
    rewriters[0].handler('head').element(el)
    expect(el.append).toHaveBeenCalledTimes(1)
    const [html, options] = el.append.mock.calls[0] as [string, { html: boolean }]
    expect(options).toEqual({ html: true })
    expect(html).toContain('property="og:title"')
    expect(html).toContain('content="Claudex Courts · Book a court"')
    expect(html).toContain('property="og:url"')
    expect(html).toContain('content="https://claudex-courts.plotline.fit/book"')
    expect(html).toContain(
      `content="${SUPABASE_URL}/storage/v1/object/public/venue-media/${BANNER}?v=${encodeURIComponent(UPDATED_AT)}"`,
    )
    expect(html).toContain('name="twitter:card"')
    expect(html).toContain('content="summary_large_image"')
    expect(html).toContain('name="apple-mobile-web-app-title"')
    expect(html).toContain('Cebu City')
    expect(html).toContain('Pickleball')
    expect(html).not.toMatch(/<title/i)
  })

  it('runs for a HEAD request too', async () => {
    const result = await run(new Request(VENUE_URL, { method: 'HEAD' }), makeEnv())
    expect(transformed).toHaveLength(1)
    expect(result).toBeInstanceOf(Response)
  })

  it('accepts venue_settings as a one-element array', async () => {
    fetchMock.mockImplementation(async () => jsonResponse([{ slug: 'claudex-courts', venue_settings: [settings] }]))
    await run(new Request(VENUE_URL), makeEnv())
    const el = fakeElement()
    rewriters[0].handler('title').element(el)
    expect(el.setInnerContent).toHaveBeenCalledWith('Claudex Courts · Book a court')
  })

  it('does not add noindex or cookies', async () => {
    const result = await run(new Request(VENUE_URL), makeEnv())
    expect(result.headers.get('set-cookie')).toBeNull()
    expect(result.headers.get('x-robots-tag')).toBeNull()
    const el = fakeElement()
    rewriters[0].handler('head').element(el)
    const [html] = el.append.mock.calls[0] as [string]
    expect(html).not.toMatch(/noindex/i)
    expect(html).not.toMatch(/name="robots"/i)
  })

  it('puts nothing from the query or hash into the Supabase request or the appended tags', async () => {
    await run(new Request('https://claudex-courts.plotline.fit/book?ref=CB-SECRET123&token=tok123#t=abc'), makeEnv())
    const sent = urlOf((fetchMock.mock.calls[0] as [unknown])[0])
    for (const secret of ['CB-SECRET123', 'tok123', 't=abc', 'token=']) expect(sent).not.toContain(secret)
    const el = fakeElement()
    const title = fakeElement()
    rewriters[0].handler('head').element(el)
    rewriters[0].handler('title').element(title)
    const [html] = el.append.mock.calls[0] as [string]
    for (const secret of ['CB-SECRET123', 'tok123', 't=abc', 'token=', 'ref=']) {
      expect(html).not.toContain(secret)
      expect(JSON.stringify(title.setInnerContent.mock.calls)).not.toContain(secret)
    }
    expect(html).toContain('content="https://claudex-courts.plotline.fit/book"')
  })
})

// --- pass-through ---------------------------------------------------------------------------------------------

describe('returns the asset unchanged', () => {
  async function expectUntouched(request: Request, asset: Response) {
    const env = makeEnv(() => asset)
    const result = await run(request, env)
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1)
    expect(result).toBe(asset)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(rewriters).toHaveLength(0)
  }

  it('for a POST', async () => {
    await expectUntouched(new Request(VENUE_URL, { method: 'POST', body: 'x' }), htmlAsset())
  })

  it('for a PUT and a DELETE', async () => {
    await expectUntouched(new Request(VENUE_URL, { method: 'PUT', body: 'x' }), htmlAsset())
    await expectUntouched(new Request(VENUE_URL, { method: 'DELETE' }), htmlAsset())
  })

  it('for the console host app.plotline.fit', async () => {
    await expectUntouched(new Request('https://app.plotline.fit/'), htmlAsset())
  })

  it('for the bare domain plotline.fit', async () => {
    await expectUntouched(new Request('https://plotline.fit/'), htmlAsset())
  })

  it('for a reserved subdomain', async () => {
    await expectUntouched(new Request('https://www.plotline.fit/'), htmlAsset())
  })

  it('for an unknown host', async () => {
    await expectUntouched(new Request('https://example.com/'), htmlAsset())
  })

  it('for a 404 page', async () => {
    await expectUntouched(new Request(VENUE_URL), htmlAsset({ status: 404 }))
  })

  it('for a redirect', async () => {
    await expectUntouched(
      new Request(VENUE_URL),
      new Response(null, { status: 301, headers: { location: '/book', 'content-type': 'text/html' } }),
    )
  })

  it('for a 200 that is not text/html', async () => {
    await expectUntouched(
      new Request(VENUE_URL),
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
  })

  it('for a 200 without a content type', async () => {
    await expectUntouched(new Request(VENUE_URL), new Response(null, { status: 200 }))
  })

  it('for an unknown or inactive venue (empty list)', async () => {
    fetchMock.mockImplementation(async () => jsonResponse([]))
    const asset = htmlAsset()
    const env = makeEnv(() => asset)
    const result = await run(new Request(VENUE_URL), env)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toBe(asset)
    expect(rewriters).toHaveLength(0)
  })

  it('for a venue without settings', async () => {
    for (const row of [{ slug: 'claudex-courts', venue_settings: null }, { slug: 'claudex-courts', venue_settings: [] }]) {
      fetchMock.mockImplementation(async () => jsonResponse([row]))
      const asset = htmlAsset()
      const result = await run(new Request(VENUE_URL), makeEnv(() => asset))
      expect(result).toBe(asset)
    }
    expect(rewriters).toHaveLength(0)
  })
})

// --- fail-open ------------------------------------------------------------------------------------------------

describe('fails open: the page is returned as it was', () => {
  it('when the Supabase read rejects', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('network down')
    })
    await expectOriginalPage(await run(new Request(VENUE_URL), makeEnv()))
  })

  it('when the Supabase read takes longer than the timeout', { timeout: 10_000 }, async () => {
    fetchMock.mockImplementation(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')))
        }),
    )
    const started = Date.now()
    const result = await run(new Request(VENUE_URL), makeEnv())
    expect(Date.now() - started).toBeLessThan(5_000)
    await expectOriginalPage(result)
  })

  it('when the Supabase read answers a non-OK status', async () => {
    fetchMock.mockImplementation(async () => new Response('{"message":"boom"}', { status: 500 }))
    await expectOriginalPage(await run(new Request(VENUE_URL), makeEnv()))
  })

  it('when the Supabase read answers 401', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ message: 'Invalid API key' }, { status: 401 }))
    await expectOriginalPage(await run(new Request(VENUE_URL), makeEnv()))
  })

  it('when the Supabase read answers invalid JSON', async () => {
    fetchMock.mockImplementation(async () => new Response('<html>not json', { status: 200 }))
    await expectOriginalPage(await run(new Request(VENUE_URL), makeEnv()))
  })

  it('when the Supabase read answers JSON of an unexpected shape', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ message: 'not a list' }))
    await expectOriginalPage(await run(new Request(VENUE_URL), makeEnv()))
  })

  it('when constructing HTMLRewriter throws', async () => {
    vi.stubGlobal(
      'HTMLRewriter',
      class {
        constructor() {
          throw new Error('no rewriter')
        }
      },
    )
    await expectOriginalPage(await run(new Request(VENUE_URL), makeEnv()))
  })

  it('when HTMLRewriter.on throws', async () => {
    vi.stubGlobal(
      'HTMLRewriter',
      class {
        on(): never {
          throw new Error('bad selector')
        }
        transform(response: Response) {
          return response
        }
      },
    )
    await expectOriginalPage(await run(new Request(VENUE_URL), makeEnv()))
  })

  it('when HTMLRewriter.transform throws', async () => {
    vi.stubGlobal(
      'HTMLRewriter',
      class {
        on() {
          return this
        }
        transform(): never {
          throw new Error('transform failed')
        }
      },
    )
    await expectOriginalPage(await run(new Request(VENUE_URL), makeEnv()))
  })

  it('when an element handler throws', async () => {
    // The fake runs the handlers on an element whose methods throw, as a failing real rewrite would, then passes the
    // body through. Either the Worker swallows the error in the handler or it falls back to the original page: the
    // visitor gets the original HTML and a 200 both ways.
    vi.stubGlobal(
      'HTMLRewriter',
      class {
        handlers: Handler[] = []
        on(_selector: string, handler: Handler) {
          this.handlers.push(handler)
          return this
        }
        transform(response: Response) {
          const broken = {
            setInnerContent: () => {
              throw new Error('handler boom')
            },
            append: () => {
              throw new Error('handler boom')
            },
            setAttribute: () => {
              throw new Error('handler boom')
            },
          }
          for (const handler of this.handlers) handler.element(broken)
          return new Response(response.body, response)
        }
      },
    )
    await expectOriginalPage(await run(new Request(VENUE_URL), makeEnv()))
  })

  it('never throws, whatever fails', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('x')
    })
    await expect(run(new Request(VENUE_URL), makeEnv())).resolves.toBeInstanceOf(Response)
  })

  it('stores nothing in the cache after a failed read', async () => {
    const cache = installCache()
    fetchMock.mockImplementation(async () => new Response('nope', { status: 503 }))
    const ctx = makeCtx()
    await run(new Request(VENUE_URL), makeEnv(), ctx)
    expect(cache.put).not.toHaveBeenCalled()
    expect(cache.store.size).toBe(0)
  })
})

// --- cache ----------------------------------------------------------------------------------------------------

describe('edge cache', () => {
  const KEY_URL = 'https://cache.plotline.fit/venue/claudex-courts'

  it('looks in caches.default under https://cache.plotline.fit/venue/<slug> before reading Supabase', async () => {
    const cache = installCache()
    await run(new Request(VENUE_URL), makeEnv())
    expect(cache.match).toHaveBeenCalled()
    expect(urlOf(cache.match.mock.calls[0][0])).toBe(KEY_URL)
  })

  it('stores the read with Cache-Control public, max-age=300 through ctx.waitUntil', async () => {
    const cache = installCache()
    const ctx = makeCtx()
    await run(new Request(VENUE_URL), makeEnv(), ctx)
    expect(cache.put).toHaveBeenCalledTimes(1)
    const [key, response] = cache.put.mock.calls[0] as [unknown, Response]
    expect(urlOf(key)).toBe(KEY_URL)
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1)
  })

  it('skips the Supabase read on a cache hit and renders the same card', async () => {
    installCache()
    const ctx = makeCtx()
    const env = makeEnv()
    await run(new Request(VENUE_URL), env, ctx)
    await Promise.all(ctx.waitUntil.mock.calls.map(([p]) => p as Promise<unknown>))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    rewriters = []
    const second = await run(new Request('https://claudex-courts.plotline.fit/book'), env, makeCtx())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await second.text()).toBe(REWRITTEN)
    const title = fakeElement()
    const head = fakeElement()
    rewriters[0].handler('title').element(title)
    rewriters[0].handler('head').element(head)
    expect(title.setInnerContent).toHaveBeenCalledWith('Claudex Courts · Book a court')
    // The cached venue is rendered for the new path.
    expect((head.append.mock.calls[0] as [string])[0]).toContain('content="https://claudex-courts.plotline.fit/book"')
  })

  it('caches per venue slug', async () => {
    installCache()
    const ctx = makeCtx()
    await run(new Request(VENUE_URL), makeEnv(), ctx)
    await Promise.all(ctx.waitUntil.mock.calls.map(([p]) => p as Promise<unknown>))
    await run(new Request('https://other-venue.plotline.fit/'), makeEnv(), makeCtx())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const slugs = fetchMock.mock.calls.map((c) => new URL(urlOf(c[0])).searchParams.get('slug'))
    expect(slugs).toEqual(['eq.claudex-courts', 'eq.other-venue'])
  })

  it('works when caches is undefined', async () => {
    vi.stubGlobal('caches', undefined)
    const result = await run(new Request(VENUE_URL), makeEnv())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await result.text()).toBe(REWRITTEN)
  })

  it('works when the cache throws on match and put', async () => {
    vi.stubGlobal('caches', {
      default: {
        match: vi.fn(async () => {
          throw new Error('cache down')
        }),
        put: vi.fn(async () => {
          throw new Error('cache down')
        }),
      },
    })
    const result = await run(new Request(VENUE_URL), makeEnv())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await result.text()).toBe(REWRITTEN)
  })

  it('works when reading caches.default throws', async () => {
    vi.stubGlobal('caches', {
      get default(): never {
        throw new Error('no default cache')
      },
    })
    const result = await run(new Request(VENUE_URL), makeEnv())
    expect(await result.text()).toBe(REWRITTEN)
  })
})

// --- the web manifest (T30.8) ---------------------------------------------------------------------------------

function manifestAsset(init: ResponseInit = {}) {
  return new Response(STATIC_MANIFEST, {
    status: 200,
    headers: { 'content-type': 'application/octet-stream', etag: '"static-manifest"' },
    ...init,
  })
}

function withVenueSettings(extra: Record<string, unknown>) {
  return [{ slug: 'claudex-courts', venue_settings: { ...settings, ...extra } }]
}

async function expectStaticManifest(result: Response) {
  expect(result.status).toBe(200)
  expect(result.headers.get('content-type')).toBe('application/manifest+json')
  expect(await result.text()).toBe(STATIC_MANIFEST)
}

async function venueManifest(rows: unknown, url = MANIFEST_URL) {
  installCache() // a fresh edge cache, so each call reads its own rows
  fetchMock.mockImplementation(async () => jsonResponse(rows))
  const result = await run(new Request(url), makeEnv(() => manifestAsset()))
  expect(result.status).toBe(200)
  return JSON.parse(await result.text()) as Record<string, unknown>
}

describe('manifest: a venue host gets the venue manifest', () => {
  it('asks ASSETS first, then returns a new 200 response with the manifest content type and a one-hour cache', async () => {
    const env = makeEnv(() => manifestAsset())
    const request = new Request(MANIFEST_URL)
    const result = await run(request, env)
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1)
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(request)
    expect(result.status).toBe(200)
    expect(result.headers.get('content-type')).toBe('application/manifest+json')
    expect(result.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(await result.text()).not.toBe(STATIC_MANIFEST)
  })

  it('builds the manifest from the venue read: name, short name, start url, scope, display, colors, Plotline icons', async () => {
    const manifest = await venueManifest(venueRows)
    expect(manifest).toEqual({
      name: 'Claudex Courts',
      short_name: 'Claudex',
      start_url: '/book',
      scope: '/',
      display: 'standalone',
      theme_color: '#f5efe6',
      background_color: '#f5efe6',
      icons: PLOTLINE_ICONS,
    })
  })

  it('reads the same venue row the pages read, with the theme column in the select', async () => {
    await venueManifest(venueRows)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [input, init] = fetchMock.mock.calls[0] as [unknown, RequestInit]
    const url = new URL(urlOf(input))
    expect(url.origin).toBe(SUPABASE_URL)
    expect(url.pathname).toBe('/rest/v1/venues')
    expect(url.searchParams.get('slug')).toBe('eq.claudex-courts')
    expect(url.searchParams.get('status')).toBe('eq.active')
    expect(url.searchParams.get('select')).toBe(
      'slug,venue_settings(name,city,banner_path,banner_alt,logo_path,sport_order,updated_at,theme)',
    )
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('uses the venue theme for both colors', async () => {
    expect(await venueManifest(withVenueSettings({ theme: 'ocean' }))).toMatchObject({
      theme_color: '#eef3f6',
      background_color: '#eef3f6',
    })
    expect(await venueManifest(withVenueSettings({ theme: 'midnight' }))).toMatchObject({
      theme_color: '#14151f',
      background_color: '#14151f',
    })
  })

  it('uses the Plotline colors when the row has no theme, a theme that is not a string, or an unknown one', async () => {
    const { theme: _theme, ...withoutTheme } = settings
    void _theme
    for (const venue_settings of [withoutTheme, { ...settings, theme: 123 }, { ...settings, theme: null }, { ...settings, theme: 'neon' }]) {
      const manifest = await venueManifest([{ slug: 'claudex-courts', venue_settings }])
      expect(manifest).toMatchObject({ theme_color: '#f5efe6', background_color: '#f5efe6' })
    }
  })

  it('uses the logo for the icons, 192 and 512, never maskable, with no Plotline icon', async () => {
    const manifest = await venueManifest(withVenueSettings({ logo_path: LOGO }))
    const src = `${SUPABASE_URL}/storage/v1/object/public/venue-media/${LOGO}?v=${encodeURIComponent(UPDATED_AT)}`
    expect(manifest.icons).toEqual([
      { src, sizes: '192x192', type: 'image/webp', purpose: 'any' },
      { src, sizes: '512x512', type: 'image/webp', purpose: 'any' },
    ])
  })

  it('does not touch HTMLRewriter', async () => {
    await venueManifest(withVenueSettings({ logo_path: LOGO }))
    expect(rewriters).toHaveLength(0)
    expect(transformed).toHaveLength(0)
  })

  it('writes the name as JSON, not HTML', async () => {
    const name = `Tom's "Best" <Courts> & Co`
    const manifest = await venueManifest(withVenueSettings({ name }))
    expect(manifest.name).toBe(name)
  })

  it('answers a HEAD request with the manifest headers', async () => {
    const result = await run(new Request(MANIFEST_URL, { method: 'HEAD' }), makeEnv(() => manifestAsset()))
    expect(result.status).toBe(200)
    expect(result.headers.get('content-type')).toBe('application/manifest+json')
    expect(result.headers.get('cache-control')).toBe('public, max-age=3600')
  })

  it('ignores a query string on the path', async () => {
    const manifest = await venueManifest(venueRows, `${MANIFEST_URL}?v=1`)
    expect(manifest.start_url).toBe('/book')
  })

  it('sets no cookie and no noindex header', async () => {
    const result = await run(new Request(MANIFEST_URL), makeEnv(() => manifestAsset()))
    expect(result.headers.get('set-cookie')).toBeNull()
    expect(result.headers.get('x-robots-tag')).toBeNull()
  })

  it('shares the venue edge cache with the pages: one read serves a page and then the manifest', async () => {
    installCache()
    const ctx = makeCtx()
    await run(new Request(VENUE_URL), makeEnv(), ctx)
    await Promise.all(ctx.waitUntil.mock.calls.map(([p]) => p as Promise<unknown>))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const result = await run(new Request(MANIFEST_URL), makeEnv(() => manifestAsset()), makeCtx())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((JSON.parse(await result.text()) as { name: string }).name).toBe('Claudex Courts')
  })

  it('stores the read under https://cache.plotline.fit/venue/<slug> with max-age=300', async () => {
    const cache = installCache()
    await run(new Request(MANIFEST_URL), makeEnv(() => manifestAsset()), makeCtx())
    expect(urlOf(cache.match.mock.calls[0][0])).toBe('https://cache.plotline.fit/venue/claudex-courts')
    expect(cache.put).toHaveBeenCalledTimes(1)
    const [, response] = cache.put.mock.calls[0] as [unknown, Response]
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
  })

  it('reads an old edge-cache entry without a theme as the Plotline colors', async () => {
    // Cached before T30.8: the venue JSON has no `theme` key.
    const old = {
      slug: 'claudex-courts',
      name: 'Claudex Courts',
      city: 'Cebu City',
      bannerPath: null,
      bannerAlt: null,
      logoPath: null,
      sportOrder: ['pickleball'],
      updatedAt: UPDATED_AT,
    }
    installCache(
      new Map([['https://cache.plotline.fit/venue/claudex-courts', new Response(JSON.stringify(old))]]),
    )
    const result = await run(new Request(MANIFEST_URL), makeEnv(() => manifestAsset()))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.status).toBe(200)
    expect(JSON.parse(await result.text())).toMatchObject({
      name: 'Claudex Courts',
      theme_color: '#f5efe6',
      background_color: '#f5efe6',
    })
  })
})

describe('manifest: everything else gets the static manifest as the assets serve it', () => {
  async function expectStatic(url: string) {
    const env = makeEnv(() => manifestAsset())
    const result = await run(new Request(url), env)
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(rewriters).toHaveLength(0)
    await expectStaticManifest(result)
    return result
  }

  it('for the console host app.plotline.fit', async () => {
    await expectStatic('https://app.plotline.fit/manifest.webmanifest')
  })

  it('for the bare domain plotline.fit', async () => {
    await expectStatic('https://plotline.fit/manifest.webmanifest')
  })

  it('for a reserved subdomain', async () => {
    await expectStatic('https://www.plotline.fit/manifest.webmanifest')
  })

  it('for an unknown host', async () => {
    await expectStatic('https://example.com/manifest.webmanifest')
  })

  it('keeps the other headers of the asset', async () => {
    const result = await expectStatic('https://app.plotline.fit/manifest.webmanifest')
    expect(result.headers.get('etag')).toBe('"static-manifest"')
  })

  it('for an unknown or inactive venue (empty list)', async () => {
    fetchMock.mockImplementation(async () => jsonResponse([]))
    await expectStaticManifest(await run(new Request(MANIFEST_URL), makeEnv(() => manifestAsset())))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('for a venue without settings', async () => {
    for (const row of [{ slug: 'claudex-courts', venue_settings: null }, { slug: 'claudex-courts', venue_settings: [] }]) {
      fetchMock.mockImplementation(async () => jsonResponse([row]))
      await expectStaticManifest(await run(new Request(MANIFEST_URL), makeEnv(() => manifestAsset())))
    }
  })

  it('when the Supabase read rejects', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('network down')
    })
    await expectStaticManifest(await run(new Request(MANIFEST_URL), makeEnv(() => manifestAsset())))
  })

  it('when the Supabase read takes longer than the timeout', { timeout: 10_000 }, async () => {
    fetchMock.mockImplementation(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')))
        }),
    )
    const started = Date.now()
    const result = await run(new Request(MANIFEST_URL), makeEnv(() => manifestAsset()))
    expect(Date.now() - started).toBeLessThan(5_000)
    await expectStaticManifest(result)
  })

  it('when the Supabase read answers a non-OK status', async () => {
    fetchMock.mockImplementation(async () => new Response('{"message":"boom"}', { status: 500 }))
    await expectStaticManifest(await run(new Request(MANIFEST_URL), makeEnv(() => manifestAsset())))
  })

  it('when the Supabase read answers invalid JSON', async () => {
    fetchMock.mockImplementation(async () => new Response('<html>not json', { status: 200 }))
    await expectStaticManifest(await run(new Request(MANIFEST_URL), makeEnv(() => manifestAsset())))
  })

  it('when the Supabase read answers JSON of an unexpected shape', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ message: 'not a list' }))
    await expectStaticManifest(await run(new Request(MANIFEST_URL), makeEnv(() => manifestAsset())))
  })

  it('never throws, whatever fails', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('x')
    })
    vi.stubGlobal('caches', {
      default: {
        match: vi.fn(async () => {
          throw new Error('cache down')
        }),
        put: vi.fn(async () => {
          throw new Error('cache down')
        }),
      },
    })
    await expect(run(new Request(MANIFEST_URL), makeEnv(() => manifestAsset()))).resolves.toBeInstanceOf(Response)
  })

  it('stores nothing in the cache after a failed read', async () => {
    const cache = installCache()
    fetchMock.mockImplementation(async () => new Response('nope', { status: 503 }))
    await run(new Request(MANIFEST_URL), makeEnv(() => manifestAsset()), makeCtx())
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('keeps the status and body of an asset that is not 200 (no forced content type)', async () => {
    const asset = new Response('missing', { status: 404, headers: { 'content-type': 'text/html' } })
    const result = await run(new Request(MANIFEST_URL), makeEnv(() => asset))
    expect(result.status).toBe(404)
    expect(await result.text()).toBe('missing')
    expect(result.headers.get('content-type')).toBe('text/html')
  })

  it('keeps a redirect of the asset as it was', async () => {
    const asset = new Response(null, { status: 301, headers: { location: '/other' } })
    const result = await run(new Request(MANIFEST_URL), makeEnv(() => asset))
    expect(result.status).toBe(301)
    expect(result.headers.get('location')).toBe('/other')
  })
})

describe('manifest: other methods get the asset unchanged', () => {
  it('for a POST, a PUT and a DELETE', async () => {
    for (const init of [{ method: 'POST', body: 'x' }, { method: 'PUT', body: 'x' }, { method: 'DELETE' }]) {
      const asset = manifestAsset()
      const env = makeEnv(() => asset)
      const result = await run(new Request(MANIFEST_URL, init), env)
      expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1)
      expect(result, init.method).toBe(asset)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  })
})

// --- apple-touch-icon (T30.8) ---------------------------------------------------------------------------------

describe('apple-touch-icon on the page paths', () => {
  const LOGO_SRC = `${SUPABASE_URL}/storage/v1/object/public/venue-media/${LOGO}?v=${encodeURIComponent(UPDATED_AT)}`

  it('registers a handler for link[rel="apple-touch-icon"] that points href at the logo', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(withVenueSettings({ logo_path: LOGO })))
    await run(new Request(VENUE_URL), makeEnv())
    const link = fakeLink()
    rewriters[0].handler(TOUCH_ICON).element(link)
    expect(link.setAttribute).toHaveBeenCalledTimes(1)
    expect(link.setAttribute).toHaveBeenCalledWith('href', LOGO_SRC)
  })

  it('does the same on /book', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(withVenueSettings({ logo_path: LOGO })))
    await run(new Request('https://claudex-courts.plotline.fit/book'), makeEnv())
    const link = fakeLink()
    rewriters[0].handler(TOUCH_ICON).element(link)
    expect(link.setAttribute).toHaveBeenCalledWith('href', LOGO_SRC)
  })

  it('keeps the title and head handlers beside it', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(withVenueSettings({ logo_path: LOGO })))
    await run(new Request(VENUE_URL), makeEnv())
    const title = fakeElement()
    const head = fakeElement()
    rewriters[0].handler('title').element(title)
    rewriters[0].handler('head').element(head)
    expect(title.setInnerContent).toHaveBeenCalledWith('Claudex Courts · Book a court')
    expect(head.append).toHaveBeenCalledTimes(1)
    expect(rewriters).toHaveLength(1)
    expect(transformed).toHaveLength(1)
  })

  it('registers no apple-touch-icon handler for a venue without a logo (the static icon stays)', async () => {
    await run(new Request(VENUE_URL), makeEnv())
    expect(rewriters).toHaveLength(1)
    expect(rewriters[0].handlers.map(([selector]) => selector)).not.toContain(TOUCH_ICON)
    expect(() => rewriters[0].handler(TOUCH_ICON)).toThrow(/no handler registered/)
    expect(() => rewriters[0].handler('title')).not.toThrow()
    expect(() => rewriters[0].handler('head')).not.toThrow()
  })

  it('serves the original page when setAttribute throws', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(withVenueSettings({ logo_path: LOGO })))
    const seen: string[] = []
    vi.stubGlobal(
      'HTMLRewriter',
      class {
        handlers: Array<[string, Handler]> = []
        on(selector: string, handler: Handler) {
          this.handlers.push([selector, handler])
          return this
        }
        transform(response: Response) {
          const broken = {
            setInnerContent: () => undefined,
            append: () => undefined,
            setAttribute: () => {
              throw new Error('setAttribute boom')
            },
          }
          for (const [selector, handler] of this.handlers) {
            seen.push(selector)
            handler.element(broken)
          }
          return new Response(response.body, response)
        }
      },
    )
    await expectOriginalPage(await run(new Request(VENUE_URL), makeEnv()))
    expect(seen).toContain(TOUCH_ICON)
  })
})
