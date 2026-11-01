import { describe, expect, it } from 'vitest'
import { ownerLinkAction, ownerLinkEmail } from './ownerInvite.ts'

describe('ownerLinkAction (T14.5d)', () => {
  it('invites an email with no account', () => {
    expect(ownerLinkAction(null)).toBe('invite')
  })
  it('sends a fresh link to an invited account without a password', () => {
    expect(ownerLinkAction({ invited_at: '2026-11-02T00:00:00Z', user_metadata: {} })).toBe('link')
    expect(ownerLinkAction({ invited_at: '2026-11-02T00:00:00Z', user_metadata: null })).toBe('link')
    expect(ownerLinkAction({ invited_at: '2026-11-02T00:00:00Z', user_metadata: { password_set: 'yes' } })).toBe('link')
  })
  it('sends nothing to an account that set its password or was never invited', () => {
    expect(ownerLinkAction({ invited_at: '2026-11-02T00:00:00Z', user_metadata: { password_set: true } })).toBe('none')
    expect(ownerLinkAction({ invited_at: null, user_metadata: {} })).toBe('none')
    expect(ownerLinkAction({})).toBe('none')
  })
})

describe('ownerLinkEmail', () => {
  const email = ownerLinkEmail({ venueName: 'Forty <Degrees>\nCourts', link: 'https://x.test/verify?a=1&b="2"' })
  it('names the venue on one line and carries the link', () => {
    expect(email.subject).toBe('Your Plotline sign-in link for Forty <Degrees> Courts')
    expect(email.text).toContain('https://x.test/verify?a=1&b="2"')
  })
  it('escapes the venue name and the link in the html', () => {
    expect(email.html).toContain('Forty &lt;Degrees&gt; Courts')
    expect(email.html).toContain('href="https://x.test/verify?a=1&amp;b=&quot;2&quot;"')
    expect(email.html).not.toContain('<Degrees>')
  })
  it('falls back to a generic venue name', () => {
    expect(ownerLinkEmail({ venueName: '  ', link: 'https://x.test' }).subject).toBe('Your Plotline sign-in link for your venue')
  })
})
