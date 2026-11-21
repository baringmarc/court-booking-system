// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './index'

const SUPABASE_URL = 'https://abcdefghijklmnop.supabase.co'
const KEY = 'sb_publishable_test_key'
const HTML = '<!doctype html><html><head><title>Plotline</title></head><body><div id="root"></div></body></html>'
const VENUE_URL = 'https://claudex-courts.plotline.fit/'
const BANNER = '11111111-1111-4111-8111-111111111111/banner/a.jpg'
const UPDATED_AT = '2026-11-20T10:15:30.123+00:00'

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
      'slug,venue_settings(name,city,banner_path,banner_alt,logo_path,sport_order,updated_at)',
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
