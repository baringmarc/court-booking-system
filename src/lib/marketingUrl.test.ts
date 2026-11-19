import { describe, expect, it } from 'vitest'
import { liveStackHandoffUrl, MARKETING_URL } from './marketingUrl'

describe('liveStackHandoffUrl', () => {
  it('points at the marketing site', () => {
    expect(MARKETING_URL).toBe('https://plotline.fit')
  })

  it('puts the code in the query and the secret only in the fragment', () => {
    expect(liveStackHandoffUrl('ABC123', 'sEcReT_-9')).toBe('https://plotline.fit/paddle-stack?live=ABC123#key=sEcReT_-9')
    const url = new URL(liveStackHandoffUrl('ABC123', 'sEcReT_-9'))
    expect(url.search).toBe('?live=ABC123')
    expect(url.hash).toBe('#key=sEcReT_-9')
    expect(url.search).not.toContain('sEcReT')
  })

  it('URI-encodes the code and the secret', () => {
    const url = liveStackHandoffUrl('a b&c', 'x/y+z=&#')
    expect(url).toBe(`https://plotline.fit/paddle-stack?live=${encodeURIComponent('a b&c')}#key=${encodeURIComponent('x/y+z=&#')}`)
    expect(url.split('#')).toHaveLength(2)
    expect(url.split('#')[0]).not.toContain('x/y')
  })
})
