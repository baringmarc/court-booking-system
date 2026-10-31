import { describe, expect, it } from 'vitest'
import { bootMode } from './bootMode'

function storage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v } }
}

describe('bootMode', () => {
  it('is console on app.plotline.fit', () => {
    expect(bootMode('app.plotline.fit', '', storage())).toBe('console')
  })

  it('is console on app.localhost', () => {
    expect(bootMode('app.localhost', '', storage())).toBe('console')
  })

  it('is venue on a venue subdomain', () => {
    expect(bootMode('claudex.plotline.fit', '', storage())).toBe('venue')
  })

  it('is venue on localhost with a ?venue= override', () => {
    expect(bootMode('localhost', '?venue=claudex', storage())).toBe('venue')
  })

  it('is venue for hosts with no venue at all, so the existing app handles them', () => {
    expect(bootMode('localhost', '', storage())).toBe('venue')
    expect(bootMode('www.plotline.fit', '', storage())).toBe('venue')
  })

  it('does not become console from a ?venue=app override', () => {
    expect(bootMode('localhost', '?venue=app', storage())).toBe('venue')
  })
})
