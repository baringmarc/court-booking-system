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

describe('ownerEmail next steps and venue address (T16.6)', () => {
  const ADDRESS = 'forty.plotline.fit'
  const full = (kind: 'invite' | 'link' | 'welcome', venueStatus?: string) => ({
    ...base,
    kind,
    ...(kind === 'welcome' ? {} : { link: LINK }),
    venueAddress: ADDRESS,
    ...(venueStatus === undefined ? {} : { venueStatus }),
  })
  const button = (kind: 'invite' | 'link' | 'welcome') => (kind === 'welcome' ? SIGN_IN : LINK)
  const kinds3 = ['invite', 'link', 'welcome'] as const

  describe.each(kinds3)('%s', (kind) => {
    const mail = ownerEmail(full(kind, 'draft'))

    it('lists three steps under "What happens next", after the button and before the address', () => {
      for (const body of [mail.text, mail.html]) {
        const heading = body.indexOf('What happens next')
        expect(heading, 'heading').toBeGreaterThan(-1)
        expect(body.indexOf(ADDRESS, heading), 'address after steps').toBeGreaterThan(heading)
        expect(body).toMatch(/checklist/i)
        expect(body).toMatch(/publish/i)
      }
      expect(mail.text.indexOf(button(kind))).toBeLessThan(mail.text.indexOf('What happens next'))
      const buttonAt = mail.html.indexOf(kind === 'welcome' ? `href="${SIGN_IN}"` : 'href="https://x.test/auth')
      expect(buttonAt).toBeGreaterThan(-1)
      expect(buttonAt).toBeLessThan(mail.html.indexOf('What happens next'))
    })

    it('puts the button before any venue-address mention, and the intro first', () => {
      const buttonAt = mail.text.indexOf(button(kind))
      expect(buttonAt).toBeGreaterThan(-1)
      expect(mail.text.indexOf(ADDRESS)).toBeGreaterThan(buttonAt)
      expect(mail.text.indexOf('Forty <Degrees> Courts')).toBeLessThan(buttonAt)
    })

    it('keeps the address after the steps and before the guide, support and sign-off', () => {
      const t = mail.text
      expect(t.indexOf('What happens next')).toBeGreaterThan(-1)
      expect(t.indexOf(ADDRESS, t.indexOf('What happens next'))).toBeLessThan(t.indexOf(GUIDE))
      expect(t.indexOf(GUIDE)).toBeLessThan(t.indexOf('plotline.admin1@gmail.com'))
      expect(t.indexOf('plotline.admin1@gmail.com')).toBeLessThan(t.indexOf('See you on court'))
    })

    it('styles the button as a pill', () => {
      const anchor = mail.html.match(/<a [^>]*style="[^"]*"[^>]*>[^<]*<\/a>/g)?.find((a) => a.includes(kind === 'welcome' ? SIGN_IN : 'x.test'))
      expect(anchor, 'button anchor with a style').toBeTruthy()
      expect(anchor).toContain('border-radius:999px')
      expect(anchor).toContain('display:inline-block')
      expect(anchor).toContain('background:#b7c4a8')
    })

    it('has no digits followed by hours, minutes or days anywhere', () => {
      expect(mail.text).not.toMatch(/a day|24 hours|\d+\s*(hours?|minutes?|days?)/i)
      expect(mail.html).not.toMatch(/a day|24 hours|\d+\s*(hours?|minutes?|days?)/i)
    })

    it('draft: the address is plain text, not a link, and goes live on publishing', () => {
      expect(mail.html).toContain(ADDRESS)
      expect(mail.html).not.toMatch(new RegExp(`<a [^>]*>[^<]*${ADDRESS.replace(/\./g, '\\.')}`))
      expect(mail.html).not.toContain('href="https://forty.plotline.fit/"')
      expect(mail.text).toMatch(/publish/i)
      expect(mail.html).toMatch(/goes live|go live|live/i)
    })

    it.each(['suspended', 'closed', 'weird'])('status %s: the address is plain text', (status) => {
      const m = ownerEmail(full(kind, status))
      expect(m.html).not.toContain('href="https://forty.plotline.fit/"')
      expect(m.html).toContain(ADDRESS)
    })

    it('omitted status: the address is plain text', () => {
      const m = ownerEmail(full(kind))
      expect(m.html).not.toContain('href="https://forty.plotline.fit/"')
      expect(m.html).toContain(ADDRESS)
    })

    it('active: the address is a link to the venue origin', () => {
      const m = ownerEmail(full(kind, 'active'))
      expect(m.html).toContain('<a href="https://forty.plotline.fit/">forty.plotline.fit</a>')
      expect(m.text).toContain(ADDRESS)
      expect(m.html.indexOf('What happens next')).toBeGreaterThan(-1)
      expect(m.html.indexOf('What happens next')).toBeLessThan(m.html.indexOf('<a href="https://forty.plotline.fit/">'))
    })
  })
})
