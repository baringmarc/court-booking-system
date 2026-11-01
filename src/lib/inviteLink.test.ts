import { describe, expect, it, vi } from 'vitest'
import { consumeInviteLink, isInviteCallback, parseInviteHash } from './inviteLink'

const HASH = '#access_token=acc.tok.en&expires_at=1&expires_in=3600&refresh_token=ref123&sb=&token_type=bearer&type=invite'

describe('parseInviteHash (T14.5c)', () => {
  it('reads the tokens of an invite link', () => {
    expect(parseInviteHash(HASH)).toEqual({ accessToken: 'acc.tok.en', refreshToken: 'ref123' })
  })
  it('reads the tokens of a resent sign-in link', () => {
    expect(parseInviteHash(HASH.replace('type=invite', 'type=magiclink'))).toEqual({ accessToken: 'acc.tok.en', refreshToken: 'ref123' })
  })
  it('ignores other link types, missing tokens and empty hashes', () => {
    expect(parseInviteHash(HASH.replace('type=invite', 'type=recovery'))).toBeNull()
    expect(parseInviteHash('#access_token=a&type=invite')).toBeNull()
    expect(parseInviteHash('#refresh_token=r&type=invite')).toBeNull()
    expect(parseInviteHash('#type=invite')).toBeNull()
    expect(parseInviteHash('')).toBeNull()
    expect(parseInviteHash('#some-anchor')).toBeNull()
  })
})

describe('isInviteCallback', () => {
  it('is true only for the params of an invite link', () => {
    expect(isInviteCallback({ access_token: 'a', refresh_token: 'r', type: 'invite' })).toBe(true)
    expect(isInviteCallback({ access_token: 'a', refresh_token: 'r', type: 'magiclink' })).toBe(true)
    expect(isInviteCallback({ access_token: 'a', refresh_token: 'r', type: 'recovery' })).toBe(false)
    expect(isInviteCallback({ code: 'abc' })).toBe(false)
  })
})

describe('consumeInviteLink', () => {
  function setup(hash: string) {
    const setSession = vi.fn().mockResolvedValue({ error: null })
    const replaceState = vi.fn()
    const loc = { hash, pathname: '/admin', search: '?x=1' }
    return { setSession, replaceState, run: () => consumeInviteLink({ auth: { setSession } }, loc, { replaceState }) }
  }

  it('signs in with the link tokens and strips them from the address bar', async () => {
    const t = setup(HASH)
    await t.run()
    expect(t.setSession).toHaveBeenCalledWith({ access_token: 'acc.tok.en', refresh_token: 'ref123' })
    expect(t.replaceState).toHaveBeenCalledWith(null, '', '/admin?x=1')
  })
  it('does nothing for a page without an invite link', async () => {
    const t = setup('')
    await t.run()
    expect(t.setSession).not.toHaveBeenCalled()
    expect(t.replaceState).not.toHaveBeenCalled()
  })
  it('never throws: a failed sign-in still strips the tokens', async () => {
    const t = setup(HASH)
    t.setSession.mockRejectedValue(new Error('network'))
    await expect(t.run()).resolves.toBeUndefined()
    expect(t.replaceState).toHaveBeenCalledWith(null, '', '/admin?x=1')
  })
})
