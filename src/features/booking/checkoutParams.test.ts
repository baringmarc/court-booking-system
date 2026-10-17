import { describe, expect, it } from 'vitest'
import { parseCheckoutSearch, toCheckoutSearch } from './checkoutParams'

const valid = { courtId: '3f1c2b9e-1d2a-4c3b-8e7f-0a1b2c3d4e5f', start: '2030-01-07T10:00:00.000Z', slots: 2 }

describe('checkout params', () => {
  it('round-trips through the URL', () => {
    expect(parseCheckoutSearch(new URLSearchParams(toCheckoutSearch(valid)))).toEqual(valid)
  })

  it('rejects missing or malformed values', () => {
    const bad = (overrides: Record<string, string>) =>
      parseCheckoutSearch(new URLSearchParams({ court: valid.courtId, start: valid.start, slots: '2', ...overrides }))
    expect(parseCheckoutSearch(new URLSearchParams())).toBeNull()
    expect(bad({ court: 'not-a-uuid' })).toBeNull()
    expect(bad({ start: 'yesterday' })).toBeNull()
    expect(bad({ slots: '0' })).toBeNull()
    expect(bad({ slots: '1.5' })).toBeNull()
    expect(bad({ slots: '25' })).toBeNull()
  })
})
