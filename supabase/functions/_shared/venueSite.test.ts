import { describe, expect, it } from 'vitest'
import { returnBase } from './paymongo.ts'
import { venueSiteBase } from './venueSite.ts'

const ROOT = 'plotline.fit'
const ALLOW = 'http://localhost:5173,https://court-booking-system.vercel.app'

type Opts = Parameters<typeof venueSiteBase>[0]
const base = (o: Partial<Opts>) =>
  venueSiteBase({ slug: 'claudex-courts', origin: null, rootDomain: ROOT, allowList: ALLOW, ...o })

describe('venueSiteBase: the venue own subdomain', () => {
  it('builds https://<slug>.<rootDomain> with no origin', () => {
    expect(base({})).toBe('https://claudex-courts.plotline.fit')
  })

  it('honours an origin equal to the venue base, trimming trailing slashes', () => {
    expect(base({ origin: 'https://claudex-courts.plotline.fit/' })).toBe('https://claudex-courts.plotline.fit')
  })

  it('works with an empty allow-list when rootDomain and slug are set', () => {
    expect(base({ allowList: undefined })).toBe('https://claudex-courts.plotline.fit')
    expect(base({ allowList: '' })).toBe('https://claudex-courts.plotline.fit')
  })
})

describe('venueSiteBase: origin is never trusted on its own', () => {
  it.each([
    ['another venue subdomain', 'https://other-venue.plotline.fit'],
    ['a lookalike host', 'https://claudex-courts.plotline.fit.evil.com'],
    ['http instead of https', 'http://claudex-courts.plotline.fit'],
    ['a different root domain', 'https://claudex-courts.example.com'],
    ['a port-suffixed host', 'https://claudex-courts.plotline.fit:8443'],
    ['an unrelated site', 'https://evil.com'],
  ])('ignores %s', (_n, origin) => {
    expect(base({ origin })).toBe('https://claudex-courts.plotline.fit')
  })

  it('ignores a foreign origin even with no rootDomain: falls back to the first allow-list entry', () => {
    expect(base({ rootDomain: undefined, origin: 'https://evil.com' })).toBe('http://localhost:5173')
  })

  it('returns null when nothing is configured', () => {
    expect(base({ rootDomain: undefined, allowList: undefined, origin: 'https://evil.com' })).toBeNull()
  })
})

describe('venueSiteBase: allow-list', () => {
  it('honours an origin that is an exact allow-list entry', () => {
    expect(base({ origin: 'https://court-booking-system.vercel.app/' })).toBe('https://court-booking-system.vercel.app')
  })

  it('prefers the venue own base origin over an allow-list entry', () => {
    const allow = 'https://claudex-courts.plotline.fit,http://localhost:5173'
    expect(base({ allowList: allow, origin: 'https://claudex-courts.plotline.fit' })).toBe(
      'https://claudex-courts.plotline.fit',
    )
  })

  it('falls back to the first allow-list entry when rootDomain is unset', () => {
    expect(base({ rootDomain: undefined })).toBe('http://localhost:5173')
  })

  it('ignores malformed allow-list entries', () => {
    expect(base({ rootDomain: undefined, allowList: 'nonsense, https://ok.example.com/ ,ftp://x.com' })).toBe(
      'https://ok.example.com',
    )
  })
})

describe('venueSiteBase: slug validation', () => {
  it.each([
    ['reserved www', 'www'],
    ['reserved app', 'app'],
    ['reserved api', 'api'],
    ['reserved admin', 'admin'],
    ['reserved demo', 'demo'],
    ['reserved staging', 'staging'],
    ['reserved mail', 'mail'],
    ['reserved help', 'help'],
    ['reserved blog', 'blog'],
    ['reserved status', 'status'],
    ['reserved support', 'support'],
    ['reserved plotline', 'plotline'],
    ['too short', 'ab'],
    ['too long', 'a'.repeat(41)],
    ['uppercase', 'Claudex'],
    ['a dot', 'a.evil.com'],
    ['a slash', 'abc/def'],
    ['an underscore', 'abc_def'],
    ['empty', ''],
  ])('never builds a subdomain from %s', (_n, slug) => {
    expect(base({ slug })).toBe('http://localhost:5173')
    expect(base({ slug, allowList: undefined })).toBeNull()
  })

  it('null and undefined slugs fall through', () => {
    expect(base({ slug: null })).toBe('http://localhost:5173')
    expect(base({ slug: undefined, allowList: undefined })).toBeNull()
  })

  it('accepts the 3 and 40 character limits', () => {
    expect(base({ slug: 'abc' })).toBe('https://abc.plotline.fit')
    const s = 'a'.repeat(40)
    expect(base({ slug: s })).toBe(`https://${s}.plotline.fit`)
  })

  it('does not honour an origin built from an invalid slug', () => {
    expect(base({ slug: 'www', origin: 'https://www.plotline.fit' })).toBe('http://localhost:5173')
  })
})

describe('venueSiteBase: rootDomain validation', () => {
  it.each([
    ['a scheme', 'https://plotline.fit'],
    ['a slash', 'plotline.fit/'],
    ['uppercase', 'Plotline.fit'],
    ['spaces', 'plotline .fit'],
    ['empty', ''],
  ])('ignores a rootDomain with %s', (_n, rootDomain) => {
    expect(base({ rootDomain })).toBe('http://localhost:5173')
    expect(base({ rootDomain, allowList: undefined })).toBeNull()
  })
})

describe('venueSiteBase: matches returnBase when rootDomain is unset (local)', () => {
  const cases: Array<[string | null, string | undefined]> = [
    [null, ALLOW],
    ['http://localhost:5173/', ALLOW],
    ['https://court-booking-system.vercel.app', ALLOW],
    ['https://evil.com', ALLOW],
    ['https://evil.com', undefined],
    [null, ''],
  ]
  it.each(cases)('origin %s, allow-list %s', (origin, allowList) => {
    expect(venueSiteBase({ slug: 'claudex-courts', origin, rootDomain: undefined, allowList })).toBe(
      returnBase(origin, allowList),
    )
  })
})
