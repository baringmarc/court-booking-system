// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url))

type Wrangler = {
  main?: string
  assets?: { binding?: string; run_worker_first?: unknown; not_found_handling?: string; directory?: string }
  routes?: unknown
  vars?: { SUPABASE_URL?: string; SUPABASE_PUBLISHABLE_KEY?: string }
}

// JSONC: drop whole-line comments only, so `//` inside strings (https://) survives.
function readWrangler(): { raw: string; config: Wrangler } {
  const raw = readFileSync(root('wrangler.jsonc'), 'utf8')
  const stripped = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  return { raw: stripped, config: JSON.parse(stripped) as Wrangler }
}

describe('wrangler.jsonc', () => {
  it('runs worker/index.ts as the Worker script', () => {
    expect(readWrangler().config.main).toBe('worker/index.ts')
  })

  it('binds the static assets as ASSETS', () => {
    expect(readWrangler().config.assets?.binding).toBe('ASSETS')
  })

  // Free plan: every Worker invocation counts against 100,000 a day. Only the two page navigations that carry a venue
  // card and the web manifest (T30.8, one small request per install or app launch) run the Worker. Assets and every
  // other path stay on the free static path (RESEARCH, "Choose the patterns to keep the count small"). Adding a
  // pattern here, such as "/*", would put every asset request on the budget.
  it('runs the Worker first for "/", "/book" and "/manifest.webmanifest" only', () => {
    expect(readWrangler().config.assets?.run_worker_first).toEqual(['/', '/book', '/manifest.webmanifest'])
  })

  it('uses no wildcard pattern in run_worker_first', () => {
    const patterns = readWrangler().config.assets?.run_worker_first
    expect(Array.isArray(patterns)).toBe(true)
    for (const pattern of patterns as string[]) expect(pattern).not.toContain('*')
  })

  it('keeps single-page-application fallback and the dist directory', () => {
    const { assets } = readWrangler().config
    expect(assets?.not_found_handling).toBe('single-page-application')
    expect(assets?.directory).toBe('./dist/')
  })

  it('keeps the venue subdomain route', () => {
    expect(readWrangler().config.routes).toEqual([{ pattern: '*.plotline.fit/*', zone_name: 'plotline.fit' }])
  })

  it('has SUPABASE_URL as an https://<ref>.supabase.co URL', () => {
    expect(readWrangler().config.vars?.SUPABASE_URL).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/)
  })

  it('has a SUPABASE_PUBLISHABLE_KEY that is not a secret', () => {
    const key = readWrangler().config.vars?.SUPABASE_PUBLISHABLE_KEY
    expect(typeof key).toBe('string')
    expect((key ?? '').length).toBeGreaterThan(0)
    expect(key).not.toMatch(/^sb_secret_/)
    expect(key).not.toContain('service_role')
  })

  it('never names a service-role key', () => {
    const { raw } = readWrangler()
    expect(raw).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
  })
})

describe('public/plotline-card.png', () => {
  it('exists, is a PNG and is 1200 x 630', () => {
    const path = root('public/plotline-card.png')
    expect(existsSync(path)).toBe(true)
    const bytes = readFileSync(path)
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(bytes.subarray(12, 16).toString('latin1')).toBe('IHDR')
    expect(bytes.readUInt32BE(16)).toBe(1200)
    expect(bytes.readUInt32BE(20)).toBe(630)
  })
})

describe('the Plotline app icons (T30.8)', () => {
  const icons: Array<[string, number]> = [
    ['public/icons/icon-192.png', 192],
    ['public/icons/icon-512.png', 512],
    ['public/icons/icon-maskable-512.png', 512],
  ]

  for (const [file, size] of icons) {
    it(`${file} exists, is a PNG and is ${size} x ${size}`, () => {
      const path = root(file)
      expect(existsSync(path)).toBe(true)
      const bytes = readFileSync(path)
      expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      expect(bytes.subarray(12, 16).toString('latin1')).toBe('IHDR')
      expect(bytes.readUInt32BE(16)).toBe(size)
      expect(bytes.readUInt32BE(20)).toBe(size)
    })
  }
})

describe('index.html (T30.8)', () => {
  const html = readFileSync(root('index.html'), 'utf8')
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'))

  it('links the web manifest inside <head>', () => {
    expect(head).toContain('<head>')
    expect(head).toMatch(/<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"\s*\/?>/)
  })

  it('keeps the static apple-touch-icon link the Worker overrides for a venue with a logo', () => {
    expect(head).toMatch(/<link\s+rel="apple-touch-icon"\s+href="\/apple-touch-icon\.png"\s*\/?>/)
  })
})

describe('public/_headers (T30.8)', () => {
  const lines = readFileSync(root('public/_headers'), 'utf8').split('\n')

  it('serves /manifest.webmanifest as application/manifest+json', () => {
    const at = lines.findIndex((line) => line.trim() === '/manifest.webmanifest')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(lines[at + 1]).toMatch(/^\s+Content-Type:\s*application\/manifest\+json\s*$/)
  })

  it('keeps the noindex rules', () => {
    for (const path of ['/booking/*', '/admin', '/admin/*']) {
      const at = lines.findIndex((line) => line.trim() === path)
      expect(at, path).toBeGreaterThanOrEqual(0)
      expect(lines[at + 1], path).toMatch(/^\s+X-Robots-Tag:\s*noindex\s*$/)
    }
  })
})
