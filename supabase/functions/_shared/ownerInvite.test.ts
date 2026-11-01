import { describe, expect, it } from 'vitest'
import { inviteOutcome, inviteRedirectTo, normalizeInviteEmail, parseInviteBody } from './ownerInvite.ts'

const ROOT = 'plotline.fit'
const ALLOW = 'http://localhost:5173,https://court-booking-system.vercel.app'
const VENUE = '3f2b8c1e-9d4a-4c55-8a1b-0123456789ab'

describe('normalizeInviteEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeInviteEmail('  Owner@Example.COM ')).toBe('owner@example.com')
  })
  it.each([[''], ['   '], ['no-at-sign'], ['a@b'], ['a b@example.com'], ['@example.com'], ['a@@example.com']])(
    'rejects %j',
    (v) => expect(normalizeInviteEmail(v)).toBeNull(),
  )
  it.each([[null], [undefined], [42], [{}], [['a@b.co']]])('rejects non-string %j', (v) =>
    expect(normalizeInviteEmail(v)).toBeNull(),
  )
  it('accepts 254 characters and rejects 255', () => {
    const at = (n: number) => `${'a'.repeat(n - '@example.com'.length)}@example.com`
    expect(normalizeInviteEmail(at(254))).toBe(at(254))
    expect(normalizeInviteEmail(at(255))).toBeNull()
  })
})

describe('inviteRedirectTo', () => {
  const base = { slug: 'claudex-courts', origin: null, rootDomain: ROOT, allowList: ALLOW }
  it('is the venue subdomain plus /admin', () => {
    expect(inviteRedirectTo(base)).toBe('https://claudex-courts.plotline.fit/admin')
  })
  it('uses the first allow-list site when there is no root domain (local)', () => {
    expect(inviteRedirectTo({ ...base, rootDomain: undefined })).toBe('http://localhost:5173/admin')
  })
  it('honours an exact allow-list origin, without doubling a trailing slash', () => {
    expect(inviteRedirectTo({ ...base, origin: 'https://court-booking-system.vercel.app/' })).toBe(
      'https://court-booking-system.vercel.app/admin',
    )
  })
  it('never follows a foreign origin', () => {
    expect(inviteRedirectTo({ ...base, origin: 'https://evil.com' })).toBe('https://claudex-courts.plotline.fit/admin')
  })
  it('is null when there is no base', () => {
    expect(inviteRedirectTo({ slug: null, origin: null, rootDomain: undefined, allowList: undefined })).toBeNull()
    expect(inviteRedirectTo({ slug: 'www', origin: null, rootDomain: ROOT, allowList: '' })).toBeNull()
  })
})

describe('parseInviteBody', () => {
  it('accepts a uuid and an email, normalizing the email', () => {
    expect(parseInviteBody({ venue_id: VENUE, email: ' Owner@Example.com ' })).toEqual({
      ok: true,
      venueId: VENUE,
      email: 'owner@example.com',
    })
  })
  it.each([
    ['not an object', null],
    ['a string', 'x'],
    ['no venue_id', { email: 'a@b.co' }],
    ['venue_id not a uuid', { venue_id: 'claudex', email: 'a@b.co' }],
    ['venue_id not a string', { venue_id: 5, email: 'a@b.co' }],
    ['no email', { venue_id: VENUE }],
    ['bad email', { venue_id: VENUE, email: 'nope' }],
  ])('rejects %s with invalid_input', (_n, body) => {
    expect(parseInviteBody(body)).toEqual({ ok: false, error: 'invalid_input' })
  })
})

describe('inviteOutcome', () => {
  it('invites only when the email has no account', () => {
    expect(inviteOutcome(null)).toEqual({ invite: true })
    expect(inviteOutcome('00000000-0000-0000-0000-0000000057a1')).toEqual({ invite: false })
  })
})
