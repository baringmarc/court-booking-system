import { describe, expect, it } from 'vitest'
import { RESERVED_SUBDOMAINS, getVenueSlug, resolveHost, type HostMode } from './venueHost'

function makeStorage(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial))
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v)
    },
  }
}

const venue = (slug: string): HostMode => ({ mode: 'venue', slug })
const none: HostMode = { mode: 'none' }
const consoleMode: HostMode = { mode: 'console' }

describe('RESERVED_SUBDOMAINS', () => {
  it('lists the reserved names from PLATFORM.md section 3', () => {
    for (const name of [
      'www', 'app', 'api', 'admin', 'demo', 'staging', 'mail', 'help', 'blog', 'status', 'support',
    ]) {
      expect(RESERVED_SUBDOMAINS).toContain(name)
    }
  })
})

describe('resolveHost: hostname modes (no override)', () => {
  const rows: [string, HostMode][] = [
    ['claudex.plotline.fit', venue('claudex')],
    ['claudex.localhost', venue('claudex')],
    ['CLAUDEX.Plotline.FIT', venue('claudex')],
    ['Claudex.LOCALHOST', venue('claudex')],
    ['my-court-2.plotline.fit', venue('my-court-2')],
    ['abc.plotline.fit', venue('abc')],
    ['a'.repeat(40) + '.plotline.fit', venue('a'.repeat(40))],
    ['ab.plotline.fit', none],
    ['a'.repeat(41) + '.plotline.fit', none],
    ['a_b-c.plotline.fit', none],
    ['ab.localhost', none],
    ['app.plotline.fit', consoleMode],
    ['APP.plotline.fit', consoleMode],
    ['app.localhost', consoleMode],
    ['plotline.fit', none],
    ['www.plotline.fit', none],
    ['a.b.plotline.fit', none],
    ['a.b.localhost', none],
  ]
  it.each(rows)('%s -> %j', (host, expected) => {
    expect(resolveHost(host, '', makeStorage())).toEqual(expected)
  })

  it.each(RESERVED_SUBDOMAINS.filter((n) => n !== 'app'))(
    'reserved name %s is none on plotline.fit and localhost',
    (name) => {
      expect(resolveHost(`${name}.plotline.fit`, '', makeStorage())).toEqual(none)
      expect(resolveHost(`${name}.localhost`, '', makeStorage())).toEqual(none)
    },
  )
})

describe('resolveHost: ?venue= override on other hosts', () => {
  it('takes the venue from the query and saves it under a single key', () => {
    const s = makeStorage()
    expect(resolveHost('localhost', '?venue=claudex', s)).toEqual(venue('claudex'))
    expect(s.data.size).toBe(1)
    expect([...s.data.values()]).toEqual(['claudex'])
  })

  it('reuses the stored venue when the query is absent', () => {
    const s = makeStorage()
    resolveHost('localhost', '?venue=claudex', s)
    expect(resolveHost('localhost', '', s)).toEqual(venue('claudex'))
    expect(resolveHost('localhost', '?other=1', s)).toEqual(venue('claudex'))
  })

  it('works on preview hosts and with other query params', () => {
    const s = makeStorage()
    expect(resolveHost('x.workers.dev', '?a=1&venue=claudex', s)).toEqual(venue('claudex'))
    expect(resolveHost('x.workers.dev', '', s)).toEqual(venue('claudex'))
  })

  it('a new query replaces the stored venue', () => {
    const s = makeStorage()
    resolveHost('localhost', '?venue=claudex', s)
    expect(resolveHost('localhost', '?venue=other-club', s)).toEqual(venue('other-club'))
    expect(s.data.size).toBe(1)
    expect(resolveHost('localhost', '', s)).toEqual(venue('other-club'))
  })

  it('no query and nothing stored is none', () => {
    const s = makeStorage()
    expect(resolveHost('localhost', '', s)).toEqual(none)
    expect(resolveHost('x.workers.dev', '', s)).toEqual(none)
    expect(s.data.size).toBe(0)
  })

  it.each(['admin', 'app', 'www', 'ab', 'a_b_c', 'a'.repeat(41), ''])(
    'invalid or reserved ?venue=%s is none and is not saved',
    (v) => {
      const s = makeStorage()
      expect(resolveHost('localhost', `?venue=${v}`, s)).toEqual(none)
      expect(s.data.size).toBe(0)
    },
  )

  it('an invalid query does not overwrite the stored venue', () => {
    const s = makeStorage()
    resolveHost('localhost', '?venue=claudex', s)
    expect(resolveHost('localhost', '?venue=admin', s)).toEqual(none)
    expect(resolveHost('localhost', '', s)).toEqual(venue('claudex'))
  })
})

describe('resolveHost: override ignored on plotline.fit and *.localhost', () => {
  it('slug host wins over ?venue= and writes nothing', () => {
    for (const host of ['claudex.plotline.fit', 'claudex.localhost']) {
      const s = makeStorage()
      expect(resolveHost(host, '?venue=other-club', s)).toEqual(venue('claudex'))
      expect(s.data.size).toBe(0)
    }
  })

  it('console host ignores ?venue= and writes nothing', () => {
    for (const host of ['app.plotline.fit', 'app.localhost']) {
      const s = makeStorage()
      expect(resolveHost(host, '?venue=claudex', s)).toEqual(consoleMode)
      expect(s.data.size).toBe(0)
    }
  })

  it('apex and reserved hosts ignore ?venue= and a stored venue', () => {
    for (const host of ['plotline.fit', 'www.plotline.fit', 'admin.localhost', 'a.b.plotline.fit']) {
      const s = makeStorage({ 'venue-override': 'claudex' })
      const before = new Map(s.data)
      expect(resolveHost(host, '?venue=claudex', s)).toEqual(none)
      expect(s.data).toEqual(before)
    }
  })
})

describe('getVenueSlug', () => {
  it('returns the slug in venue mode', () => {
    expect(getVenueSlug('claudex.plotline.fit', '', makeStorage())).toBe('claudex')
    expect(getVenueSlug('localhost', '?venue=claudex', makeStorage())).toBe('claudex')
  })

  it('returns null in console and none modes', () => {
    expect(getVenueSlug('app.plotline.fit', '', makeStorage())).toBeNull()
    expect(getVenueSlug('plotline.fit', '', makeStorage())).toBeNull()
    expect(getVenueSlug('localhost', '', makeStorage())).toBeNull()
  })
})
