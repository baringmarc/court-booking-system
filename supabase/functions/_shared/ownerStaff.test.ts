import { describe, expect, it } from 'vitest'
import { mergeMemberRole, ownerEmail, parseInviteBody, type MemberRole } from './ownerInvite.ts'

const VENUE_ID = '3f2b8c1e-9d4a-4c55-8a1b-0123456789ab'

describe('parseInviteBody role (T24.1)', () => {
  it('defaults an absent role to owner', () => {
    expect(parseInviteBody({ venue_id: VENUE_ID, email: 'a@b.co' })).toEqual({
      ok: true,
      venueId: VENUE_ID,
      email: 'a@b.co',
      role: 'owner',
    })
  })
  it.each<MemberRole>(['owner', 'staff'])('accepts role %s', (role) => {
    expect(parseInviteBody({ venue_id: VENUE_ID, email: 'a@b.co', role })).toEqual({
      ok: true,
      venueId: VENUE_ID,
      email: 'a@b.co',
      role,
    })
  })
  it.each([[null], [5], ['admin'], ['Staff'], ['OWNER'], [''], [' staff'], [{}], [['staff']]])(
    'rejects role %j with invalid_input',
    (role) => {
      expect(parseInviteBody({ venue_id: VENUE_ID, email: 'a@b.co', role })).toEqual({ ok: false, error: 'invalid_input' })
    },
  )
})

describe('mergeMemberRole (T24.1)', () => {
  it.each<[MemberRole | null, MemberRole, MemberRole]>([
    [null, 'owner', 'owner'],
    [null, 'staff', 'staff'],
    ['staff', 'owner', 'owner'],
    ['owner', 'staff', 'owner'],
    ['owner', 'owner', 'owner'],
    ['staff', 'staff', 'staff'],
  ])('existing %s + requested %s => %s', (existing, requested, expected) => {
    expect(mergeMemberRole(existing, requested)).toBe(expected)
  })
})

const GUIDE = 'https://plotline.fit/guides/venue-owner-manual-v1.0.pdf'
const SIGN_IN = 'https://forty.plotline.fit/admin'
const LINK = 'https://x.test/auth/v1/verify?a=1&b="2"'
const ADDRESS = 'forty.plotline.fit'
const base = { venueName: 'Forty <Degrees>\nCourts', venueUrl: SIGN_IN, guideUrl: GUIDE }
const mk = (kind: 'invite' | 'link' | 'welcome', extra: { venueAddress?: string; venueStatus?: string } = {}) => ({
  ...base,
  kind,
  ...(kind === 'welcome' ? {} : { link: LINK }),
  ...extra,
})
const kinds = ['invite', 'link', 'welcome'] as const

describe('ownerEmail role owner is unchanged (T24.1)', () => {
  it.each(kinds)('%s: role owner equals no role', (kind) => {
    for (const extra of [{}, { venueAddress: ADDRESS, venueStatus: 'active' }, { venueAddress: ADDRESS, venueStatus: 'draft' }]) {
      const input = mk(kind, extra)
      expect(ownerEmail({ ...input, role: 'owner' })).toEqual(ownerEmail(input))
    }
  })
})

describe('ownerEmail role staff (T24.1)', () => {
  describe.each(kinds)('%s', (kind) => {
    const mail = ownerEmail({ ...mk(kind, { venueAddress: ADDRESS, venueStatus: 'draft' }), role: 'staff' })

    it('names the venue on one line and escapes it in the html', () => {
      expect(mail.subject).toContain('Forty <Degrees> Courts')
      expect(mail.text).toContain('Forty <Degrees> Courts')
      expect(mail.html).toContain('Forty &lt;Degrees&gt; Courts')
      expect(mail.html).not.toContain('<Degrees>')
    })

    it('says the person was added as staff, not as the owner', () => {
      expect(`${mail.subject}\n${mail.text}`).toMatch(/staff/i)
      expect(mail.html).toMatch(/staff/i)
      expect(mail.text).not.toMatch(/as the owner/i)
      expect(mail.html).not.toMatch(/as the owner/i)
      expect(mail.subject).not.toMatch(/as the owner/i)
    })

    it('links the guide but does not claim it is attached', () => {
      expect(mail.html).toContain(GUIDE)
      expect(mail.text).toContain(GUIDE)
      expect(mail.html).not.toMatch(/attach/i)
      expect(mail.text).not.toMatch(/attach/i)
      expect(mail.subject).not.toMatch(/attach/i)
    })

    it('has no setup checklist or publish steps', () => {
      for (const body of [mail.html, mail.text]) {
        expect(body).not.toMatch(/checklist/i)
        expect(body).not.toMatch(/publish/i)
      }
    })

    it('keeps support, Facebook, Messenger and the offer of a call', () => {
      for (const part of ['plotline.admin1@gmail.com', 'https://www.facebook.com/profile.php?id=61595759948011', 'https://m.me/61595759948011']) {
        expect(mail.html, part).toContain(part)
        expect(mail.text, part).toContain(part)
      }
      expect(mail.text).toMatch(/\bcall\b/i)
      expect(mail.html).toMatch(/\bcall\b/i)
    })

    it('has no fixed durations', () => {
      expect(mail.text).not.toMatch(/a day|24 hours|\d+\s*(hours?|minutes?|days?)/i)
      expect(mail.html).not.toMatch(/a day|24 hours|\d+\s*(hours?|minutes?|days?)/i)
    })

    it('names the venue address as plain text for a draft venue', () => {
      expect(mail.text).toContain(ADDRESS)
      expect(mail.html).toContain(ADDRESS)
      expect(mail.html).not.toContain('href="https://forty.plotline.fit/"')
    })

    it.each(['suspended', 'weird'])('status %s: address is plain text', (status) => {
      const m = ownerEmail({ ...mk(kind, { venueAddress: ADDRESS, venueStatus: status }), role: 'staff' })
      expect(m.html).toContain(ADDRESS)
      expect(m.html).not.toContain('href="https://forty.plotline.fit/"')
    })

    it('omitted status: address is plain text', () => {
      const m = ownerEmail({ ...mk(kind, { venueAddress: ADDRESS }), role: 'staff' })
      expect(m.html).toContain(ADDRESS)
      expect(m.text).toContain(ADDRESS)
      expect(m.html).not.toContain('href="https://forty.plotline.fit/"')
    })

    it('active: address is a link to the venue origin', () => {
      const m = ownerEmail({ ...mk(kind, { venueAddress: ADDRESS, venueStatus: 'active' }), role: 'staff' })
      expect(m.html).toContain('<a href="https://forty.plotline.fit/">forty.plotline.fit</a>')
      expect(m.text).toContain(ADDRESS)
      expect(m.html).not.toMatch(/checklist|publish|attach/i)
    })
  })

  it.each(['invite', 'link'] as const)('%s carries the link as the button, escaped', (kind) => {
    const mail = ownerEmail({ ...mk(kind), role: 'staff' })
    expect(mail.text).toContain(LINK)
    expect(mail.html).toContain('href="https://x.test/auth/v1/verify?a=1&amp;b=&quot;2&quot;"')
    expect(mail.text).toMatch(/once/i)
    expect(mail.text).toMatch(/expire/i)
  })

  it('invite is about account setup and link about a fresh access link', () => {
    expect(ownerEmail({ ...mk('invite'), role: 'staff' }).text).toMatch(/account/i)
    expect(ownerEmail({ ...mk('link'), role: 'staff' }).text).toMatch(/fresh|new/i)
  })

  it('welcome links to the venue sign-in, with no reset wording and no token link', () => {
    const mail = ownerEmail({ ...mk('welcome'), role: 'staff' })
    expect(mail.text).toContain(SIGN_IN)
    expect(mail.html).toContain(`href="${SIGN_IN}"`)
    expect(mail.text).toMatch(/sign in/i)
    for (const body of [mail.text, mail.html]) expect(body).not.toMatch(/reset|forgot/i)
    expect(mail.text).not.toMatch(/token|verify/i)
  })

  it('falls back to a generic venue name', () => {
    const mail = ownerEmail({ ...mk('welcome'), venueName: '  ', role: 'staff' })
    expect(mail.subject).toContain('your venue')
  })

  it('differs from the owner email', () => {
    for (const kind of kinds) {
      expect(ownerEmail({ ...mk(kind), role: 'staff' }).text).not.toBe(ownerEmail(mk(kind)).text)
    }
  })
})
