// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { RESERVED_SUBDOMAINS as APP_RESERVED_SUBDOMAINS } from '../src/lib/venueHost'
import {
  RESERVED_SUBDOMAINS,
  buildVenueCard,
  escapeHtml,
  renderHeadTags,
  venueSlugFromHost,
  type VenueCard,
  type VenueCardData,
} from './venueCard'

const SUPABASE_URL = 'https://abcdefghijklmnop.supabase.co'
const ORIGIN = 'https://claudex-courts.plotline.fit'
const BANNER = '11111111-1111-4111-8111-111111111111/banner/a.jpg'
const LOGO = '11111111-1111-4111-8111-111111111111/logo/b.png'
const UPDATED_AT = '2026-11-20T10:15:30.123+00:00'

const venue: VenueCardData = {
  slug: 'claudex-courts',
  name: 'Claudex Courts',
  city: 'Cebu City',
  bannerPath: BANNER,
  bannerAlt: 'Indoor courts at dusk',
  logoPath: LOGO,
  sportOrder: ['pickleball', 'badminton', 'tennis'],
  updatedAt: UPDATED_AT,
}

const ctx = { origin: ORIGIN, path: '/', supabaseUrl: SUPABASE_URL }

function mediaUrl(path: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/venue-media/${path}?v=${encodeURIComponent(UPDATED_AT)}`
}

describe('venue from the host (same rule as the app, no ?venue= override)', () => {
  it('reads the slug from <slug>.plotline.fit', () => {
    expect(venueSlugFromHost('claudex-courts.plotline.fit')).toBe('claudex-courts')
  })

  it('reads the slug from <slug>.localhost', () => {
    expect(venueSlugFromHost('claudex-courts.localhost')).toBe('claudex-courts')
  })

  it('lowercases the hostname', () => {
    expect(venueSlugFromHost('Claudex-Courts.Plotline.Fit')).toBe('claudex-courts')
  })

  it('returns null for the bare domains', () => {
    expect(venueSlugFromHost('plotline.fit')).toBeNull()
    expect(venueSlugFromHost('localhost')).toBeNull()
    expect(venueSlugFromHost('')).toBeNull()
  })

  it('returns null for the console host app.plotline.fit', () => {
    expect(venueSlugFromHost('app.plotline.fit')).toBeNull()
  })

  it('returns null for every reserved name', () => {
    for (const reserved of ['www', 'staging', 'demo', ...RESERVED_SUBDOMAINS]) {
      expect(venueSlugFromHost(`${reserved}.plotline.fit`), reserved).toBeNull()
    }
  })

  it('keeps the reserved list equal to the app list in src/lib/venueHost.ts', () => {
    expect([...RESERVED_SUBDOMAINS]).toEqual([...APP_RESERVED_SUBDOMAINS])
  })

  it('accepts slugs of 3 to 40 characters and rejects 2 and 41', () => {
    expect(venueSlugFromHost('abc.plotline.fit')).toBe('abc')
    expect(venueSlugFromHost(`${'a'.repeat(40)}.plotline.fit`)).toBe('a'.repeat(40))
    expect(venueSlugFromHost('ab.plotline.fit')).toBeNull()
    expect(venueSlugFromHost(`${'a'.repeat(41)}.plotline.fit`)).toBeNull()
  })

  it('rejects characters outside a-z, 0-9 and the dash', () => {
    expect(venueSlugFromHost('my_courts.plotline.fit')).toBeNull()
    expect(venueSlugFromHost('my courts.plotline.fit')).toBeNull()
  })

  it('returns null for a slug with a dot (nested subdomain)', () => {
    expect(venueSlugFromHost('a.b.plotline.fit')).toBeNull()
    expect(venueSlugFromHost('abc.def.plotline.fit')).toBeNull()
  })

  it('returns null for look-alike hosts', () => {
    expect(venueSlugFromHost('claudex-courts.plotline.fit.evil.com')).toBeNull()
    expect(venueSlugFromHost('claudex-courtsplotline.fit')).toBeNull()
    expect(venueSlugFromHost('claudex-courts.notplotline.fit')).toBeNull()
    expect(venueSlugFromHost('claudex-courts.example.com')).toBeNull()
  })
})

describe('buildVenueCard', () => {
  it('titles the card "<name> · Book a court" with a middle dot', () => {
    expect(buildVenueCard(venue, ctx).title).toBe('Claudex Courts · Book a court')
  })

  it('describes the venue with its name, city and sport labels in the venue order', () => {
    const { description } = buildVenueCard(venue, ctx)
    expect(description).toContain('Claudex Courts')
    expect(description).toContain('Cebu City')
    expect(description).toContain('Pickleball')
    expect(description).toContain('Badminton')
    expect(description).toContain('Tennis')
    expect(description).not.toContain('Basketball')
    expect(description.indexOf('Pickleball')).toBeLessThan(description.indexOf('Badminton'))
    expect(description.indexOf('Badminton')).toBeLessThan(description.indexOf('Tennis'))
  })

  it('labels basketball, and keeps another order when the venue orders its sports differently', () => {
    const { description } = buildVenueCard({ ...venue, sportOrder: ['basketball', 'tennis'] }, ctx)
    expect(description).toContain('Basketball')
    expect(description.indexOf('Basketball')).toBeLessThan(description.indexOf('Tennis'))
    expect(description).not.toContain('Pickleball')
  })

  it('keeps the name and city and no stray punctuation when the venue has no sports', () => {
    const { description } = buildVenueCard({ ...venue, sportOrder: [] }, ctx)
    expect(description).toContain('Claudex Courts')
    expect(description).toContain('Cebu City')
    expect(description).not.toMatch(/,\s*,/)
    expect(description).not.toMatch(/,\s*\./)
    expect(description).not.toMatch(/undefined|null/)
  })

  it('uses the banner as the image, with a versioned public storage URL', () => {
    const card = buildVenueCard(venue, ctx)
    expect(card.image).toBe(mediaUrl(BANNER))
    expect(card.twitterCard).toBe('summary_large_image')
    expect(card.imageAlt).toBe('Indoor courts at dusk')
  })

  it('changes the image URL when the settings are updated (Facebook caches by URL)', () => {
    const a = buildVenueCard(venue, ctx).image
    const b = buildVenueCard({ ...venue, updatedAt: '2026-11-21T00:00:00+00:00' }, ctx).image
    expect(a).not.toBe(b)
  })

  it('has no image alt when the banner alt is empty or null', () => {
    expect(buildVenueCard({ ...venue, bannerAlt: '' }, ctx).imageAlt).toBeNull()
    expect(buildVenueCard({ ...venue, bannerAlt: null }, ctx).imageAlt).toBeNull()
  })

  it('falls back to the logo without a banner, as a small "summary" card', () => {
    const card = buildVenueCard({ ...venue, bannerPath: null, bannerAlt: null }, ctx)
    expect(card.image).toBe(mediaUrl(LOGO))
    expect(card.twitterCard).toBe('summary')
    expect(card.imageAlt).toBe('Claudex Courts logo')
  })

  it('falls back to the Plotline card with neither banner nor logo', () => {
    const card = buildVenueCard({ ...venue, bannerPath: null, bannerAlt: null, logoPath: null }, ctx)
    expect(card.image).toBe(`${ORIGIN}/plotline-card.png`)
    expect(card.twitterCard).toBe('summary_large_image')
    expect(card.imageAlt).toBeNull()
  })

  it('removes the query string and hash from the url', () => {
    const card = buildVenueCard(venue, { ...ctx, path: '/book?sport=tennis#x' })
    expect(card.url).toBe(`${ORIGIN}/book`)
  })

  it('uses origin plus path as the url', () => {
    expect(buildVenueCard(venue, ctx).url).toBe(`${ORIGIN}/`)
    expect(buildVenueCard(venue, { ...ctx, path: '/book' }).url).toBe(`${ORIGIN}/book`)
  })

  it('sets the app title to the venue name', () => {
    expect(buildVenueCard(venue, ctx).appTitle).toBe('Claudex Courts')
  })
})

type Meta = { attrs: Record<string, string>; raw: string }

function unescape(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function parseMetas(html: string): Meta[] {
  const metas: Meta[] = []
  for (const match of html.matchAll(/<meta\s([^>]*)>/g)) {
    const attrs: Record<string, string> = {}
    for (const attr of match[1].matchAll(/([a-zA-Z][\w:-]*)="([^"]*)"/g)) attrs[attr[1]] = unescape(attr[2])
    metas.push({ attrs, raw: match[0] })
  }
  return metas
}

function contentOf(metas: Meta[], key: string) {
  const meta = metas.find((m) => m.attrs.name === key || m.attrs.property === key)
  return meta?.attrs.content
}

describe('renderHeadTags', () => {
  const card = buildVenueCard(venue, { ...ctx, path: '/book' })

  it('renders every tag with the card values', () => {
    const metas = parseMetas(renderHeadTags(card))
    expect(contentOf(metas, 'description')).toBe(card.description)
    expect(contentOf(metas, 'og:title')).toBe(card.title)
    expect(contentOf(metas, 'og:description')).toBe(card.description)
    expect(contentOf(metas, 'og:image')).toBe(card.image)
    expect(contentOf(metas, 'og:image:alt')).toBe('Indoor courts at dusk')
    expect(contentOf(metas, 'og:url')).toBe(`${ORIGIN}/book`)
    expect(contentOf(metas, 'og:type')).toBe('website')
    expect(contentOf(metas, 'twitter:card')).toBe('summary_large_image')
    expect(contentOf(metas, 'apple-mobile-web-app-title')).toBe('Claudex Courts')
    expect(metas).toHaveLength(9)
  })

  it('uses name= for description, twitter and apple tags and property= for og tags', () => {
    const metas = parseMetas(renderHeadTags(card))
    for (const key of ['description', 'twitter:card', 'apple-mobile-web-app-title']) {
      expect(metas.some((m) => m.attrs.name === key), key).toBe(true)
    }
    for (const key of ['og:title', 'og:description', 'og:image', 'og:image:alt', 'og:url', 'og:type']) {
      expect(metas.some((m) => m.attrs.property === key), key).toBe(true)
    }
  })

  it('leaves out og:image:alt when the card has no image alt', () => {
    const html = renderHeadTags({ ...card, imageAlt: null })
    const metas = parseMetas(html)
    expect(contentOf(metas, 'og:image:alt')).toBeUndefined()
    expect(html).not.toContain('og:image:alt')
    expect(metas).toHaveLength(8)
  })

  it('renders the small card type for a logo', () => {
    const logoCard: VenueCard = { ...card, twitterCard: 'summary' }
    expect(contentOf(parseMetas(renderHeadTags(logoCard)), 'twitter:card')).toBe('summary')
  })

  it('renders meta tags only, no <title>', () => {
    const html = renderHeadTags(card)
    expect(html).not.toMatch(/<title/i)
    expect(html.match(/</g)?.length).toBe(html.match(/<meta/g)?.length)
  })

  it('escapes a hostile venue name in every attribute and keeps the tags well-formed', () => {
    const name = `Tom's "Best" <Courts> & Co`
    const evil = buildVenueCard(
      { ...venue, name, city: `Cebu "City" <b>`, bannerAlt: `"><script>alert(1)</script>` },
      ctx,
    )
    const html = renderHeadTags(evil)
    expect(html).not.toContain('<Courts>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<b>')
    expect(html).not.toContain("Tom's")
    expect(html).not.toContain('"Best"')
    // Only the tag openers contain `<`, and each tag is exactly <meta key="…" content="…">.
    expect(html.match(/</g)?.length).toBe(html.match(/<meta/g)?.length)
    expect(html.match(/>/g)?.length).toBe(html.match(/<meta/g)?.length)
    const metas = parseMetas(html)
    expect(metas).toHaveLength(9)
    for (const meta of metas) {
      expect(Object.keys(meta.attrs), meta.raw).toHaveLength(2)
      expect(meta.raw.match(/"/g)?.length, meta.raw).toBe(4)
    }
    expect(contentOf(metas, 'og:title')).toBe(`${name} · Book a court`)
    expect(contentOf(metas, 'apple-mobile-web-app-title')).toBe(name)
    expect(contentOf(metas, 'og:image:alt')).toBe(`"><script>alert(1)</script>`)
  })
})

describe('escapeHtml', () => {
  it('escapes & < > " and the single quote', () => {
    const out = escapeHtml(`& < > " '`)
    expect(out).not.toMatch(/[<>"']/)
    expect(out).toContain('&amp;')
    expect(out).toContain('&lt;')
    expect(out).toContain('&gt;')
    expect(out).toContain('&quot;')
    expect(out).toMatch(/&#0?39;|&#x27;|&apos;/)
    expect(unescape(out)).toBe(`& < > " '`)
  })

  it('escapes an ampersand once and leaves plain text alone', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry')
    expect(escapeHtml('Claudex Courts')).toBe('Claudex Courts')
    expect(escapeHtml('')).toBe('')
  })
})
