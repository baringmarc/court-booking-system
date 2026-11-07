import { describe, expect, it } from 'vitest'
import { ownerEmail, ownerLinkAction } from './ownerInvite.ts'

describe('ownerLinkAction (T17.25)', () => {
  it('invites an email with no account', () => {
    expect(ownerLinkAction(null)).toBe('invite')
  })
  it('sends a fresh link to an invited account without a password', () => {
    expect(ownerLinkAction({ invited_at: '2026-11-02T00:00:00Z', user_metadata: {} })).toBe('link')
    expect(ownerLinkAction({ invited_at: '2026-11-02T00:00:00Z', user_metadata: null })).toBe('link')
    expect(ownerLinkAction({ invited_at: '2026-11-02T00:00:00Z', user_metadata: { password_set: 'yes' } })).toBe('link')
  })
  it('sends a welcome email to every other existing account', () => {
    expect(ownerLinkAction({ invited_at: '2026-11-02T00:00:00Z', user_metadata: { password_set: true } })).toBe('welcome')
    expect(ownerLinkAction({ invited_at: null, user_metadata: {} })).toBe('welcome')
    expect(ownerLinkAction({})).toBe('welcome')
  })
})

const GUIDE = 'https://plotline.fit/guides/venue-owner-manual-v1.0.pdf'
const SIGN_IN = 'https://forty.plotline.fit/admin'
const LINK = 'https://x.test/auth/v1/verify?a=1&b="2"'
const base = { venueName: 'Forty <Degrees>\nCourts', venueUrl: SIGN_IN, guideUrl: GUIDE }

describe('ownerEmail (T17.25)', () => {
  const kinds = [
    ['invite', { ...base, kind: 'invite' as const, link: LINK }],
    ['link', { ...base, kind: 'link' as const, link: LINK }],
    ['welcome', { ...base, kind: 'welcome' as const }],
  ] as const

  describe.each(kinds)('%s', (_name, input) => {
    const mail = ownerEmail(input)
    it('names the venue on one line and escapes it in the html', () => {
      expect(mail.subject).toContain('Forty <Degrees> Courts')
      expect(mail.text).toContain('Forty <Degrees> Courts')
      expect(mail.html).toContain('Forty &lt;Degrees&gt; Courts')
      expect(mail.html).not.toContain('<Degrees>')
    })
    it('links to the guide, support, Facebook and Messenger in html and text', () => {
      for (const part of [GUIDE, 'plotline.admin1@gmail.com', 'https://www.facebook.com/profile.php?id=61595759948011', 'https://m.me/61595759948011']) {
        expect(mail.html, part).toContain(part)
        expect(mail.text, part).toContain(part)
      }
    })
    it('offers to arrange a call by contacting support', () => {
      expect(mail.text).toMatch(/\bcall\b/i)
      expect(mail.html).toMatch(/\bcall\b/i)
    })
  })

  it.each(['invite', 'link'] as const)('%s carries the link as the button and a neutral expiry', (kind) => {
    const mail = ownerEmail({ ...base, kind, link: LINK })
    expect(mail.text).toContain(LINK)
    expect(mail.html).toContain('href="https://x.test/auth/v1/verify?a=1&amp;b=&quot;2&quot;"')
    expect(mail.text).toMatch(/password/i)
    expect(mail.text).not.toMatch(/a day|24 hours|\d+\s*(hours?|minutes?|days?)/i)
    expect(mail.html).not.toMatch(/a day|24 hours|\d+\s*(hours?|minutes?|days?)/i)
  })
  it('invite is about account setup and link about a fresh access link', () => {
    expect(ownerEmail({ ...base, kind: 'invite', link: LINK }).text).toMatch(/account/i)
    expect(ownerEmail({ ...base, kind: 'link', link: LINK }).text).toMatch(/fresh|new/i)
  })

  it('welcome links to the venue sign-in, mentions no password reset and has no token link', () => {
    const mail = ownerEmail({ ...base, kind: 'welcome' })
    expect(mail.text).toContain(SIGN_IN)
    expect(mail.html).toContain(`href="${SIGN_IN}"`)
    expect(mail.text).not.toMatch(/reset|forgot/i)
    expect(mail.html).not.toMatch(/reset|forgot/i)
    expect(mail.text).not.toMatch(/token|verify/i)
  })

  it('falls back to a generic venue name', () => {
    expect(ownerEmail({ ...base, venueName: '  ', kind: 'welcome' }).subject).toContain('your venue')
  })
})
