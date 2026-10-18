import { describe, expect, it } from 'vitest'
import { guestBookingPath, readGuestToken } from './guestLink'

describe('readGuestToken', () => {
  it('reads the token from the fragment', () => {
    expect(readGuestToken('', '#token=abc-123_XYZ')).toEqual({ token: 'abc-123_XYZ', rewriteTo: null })
  })

  it('returns null when there is no token', () => {
    expect(readGuestToken('', '')).toEqual({ token: null, rewriteTo: null })
    expect(readGuestToken('?foo=1', '#other=2')).toEqual({ token: null, rewriteTo: null })
  })

  it('keeps an empty token (a cut-off link) as a guest read', () => {
    expect(readGuestToken('', '#token=')).toEqual({ token: '', rewriteTo: null })
  })

  it('rewrites a legacy ?token= link to the fragment', () => {
    expect(readGuestToken('?token=legacy', '')).toEqual({ token: 'legacy', rewriteTo: { search: '', hash: '#token=legacy' } })
  })

  it('keeps other query params when rewriting', () => {
    expect(readGuestToken('?utm=x&token=legacy', '')).toEqual({ token: 'legacy', rewriteTo: { search: '?utm=x', hash: '#token=legacy' } })
  })

  it('prefers the fragment when both are present, and still drops the query token', () => {
    expect(readGuestToken('?token=old', '#token=new')).toEqual({ token: 'new', rewriteTo: { search: '', hash: '#token=new' } })
  })

  it('round-trips tokens that need encoding', () => {
    const { hash } = readGuestToken('?token=a%2Bb%3D', '').rewriteTo!
    expect(readGuestToken('', hash).token).toBe('a+b=')
  })
})

describe('guestBookingPath', () => {
  it('puts the token in the fragment', () => {
    expect(guestBookingPath('CB-7KQ2XD', 'tok_en-1')).toBe('/booking/CB-7KQ2XD#token=tok_en-1')
  })
})
