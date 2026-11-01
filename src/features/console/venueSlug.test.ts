// T14.6: suggestSlug turns a venue name into a subdomain suggestion.
import { describe, expect, it } from 'vitest'
import { suggestSlug } from './venueSlug'

describe('suggestSlug', () => {
  it.each([
    ['Smash Pickleball Club', 'smash-pickleball-club'],
    ['  Café  Nº1! ', 'caf-n-1'],
    ['E2E Padel Club', 'e2e-padel-club'],
    ['---Hello---World---', 'hello-world'],
    ['A   B', 'a-b'],
    ['', ''],
    ['!!!', ''],
  ])('%j -> %j', (input, expected) => {
    expect(suggestSlug(input)).toBe(expected)
  })

  it('cuts at 40 characters with no trailing hyphen', () => {
    const out = suggestSlug('a'.repeat(39) + ' ' + 'b'.repeat(10))
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out.endsWith('-')).toBe(false)
    expect(out).toBe('a'.repeat(39))
    expect(suggestSlug('x'.repeat(60))).toBe('x'.repeat(40))
  })
})
