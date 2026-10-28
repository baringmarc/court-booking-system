import { describe, expect, it } from 'vitest'
import { shownAmenities } from './amenities'
import type { Amenity } from './api'
import { mapsUrlProblem, placeNameFromMapsUrl } from './map'
import { socialUrlProblem } from './social'

const row = (id: string, created_at: string, patch: Partial<Amenity>): Amenity =>
  ({ id, created_at, builtin_key: null, custom_name: null, ...patch })

describe('shownAmenities', () => {
  it('lists built-ins in catalog order, then custom ones in the order they were added', () => {
    const rows = [
      row('c2', '2030-01-02', { custom_name: ' Sauna ' }),
      row('b1', '2030-01-03', { builtin_key: 'wifi' }),
      row('c1', '2030-01-01', { custom_name: 'Massage chairs' }),
      row('b2', '2030-01-04', { builtin_key: 'restrooms' }),
    ]
    expect(shownAmenities(rows).map((a) => a.label)).toEqual(['Restrooms (CR)', 'Wi-Fi', 'Massage chairs', 'Sauna'])
  })
})

describe('mapsUrlProblem', () => {
  it('accepts the four Maps hosts and empty, like the database check', () => {
    for (const url of ['', 'https://maps.app.goo.gl/AbC123', 'https://goo.gl/maps/AbC123', 'https://maps.google.com/?q=Claudex',
      'https://www.google.com/maps/place/Claudex+Courts/@14.55,121.02,17z', 'https://www.google.com/maps?q=x', 'https://www.google.com/maps']) {
      expect(mapsUrlProblem(url), url).toBeNull()
    }
  })

  it('refuses http, other hosts, lookalikes, tricks, whitespace and over-long links', () => {
    for (const url of ['http://maps.app.goo.gl/x', 'https://www.example.com/maps', 'https://www.google.com/search?q=x',
      'https://www.google.com/mapsfoo', 'https://maps.google.com.evil.test/x', 'https://maps.app.goo.gl@evil.test/x',
      'javascript:alert(1)', 'https://maps.app.goo.gl/a b', 'HTTPS://maps.app.goo.gl/x']) {
      expect(mapsUrlProblem(url), url).toMatch(/Paste a Google Maps link/)
    }
    expect(mapsUrlProblem(`https://maps.app.goo.gl/${'a'.repeat(1000 - 24)}`)).toBeNull()
    expect(mapsUrlProblem(`https://maps.app.goo.gl/${'a'.repeat(1001 - 24)}`)).toMatch(/at most 1000/)
  })
})

describe('placeNameFromMapsUrl', () => {
  it("reads a long link's place name, decoding + and %-escapes", () => {
    expect(placeNameFromMapsUrl('https://www.google.com/maps/place/Claudex+Courts,+Makati/@14.55,121.02,17z')).toBe('Claudex Courts, Makati')
    expect(placeNameFromMapsUrl('https://maps.google.com/maps/place/Para%C3%B1aque%20Courts?entry=ttu')).toBe('Parañaque Courts')
  })

  it('gives nothing for short links, search links or a broken escape', () => {
    expect(placeNameFromMapsUrl('https://maps.app.goo.gl/AbC123')).toBe('')
    expect(placeNameFromMapsUrl('https://www.google.com/maps/search/?api=1&query=x')).toBe('')
    expect(placeNameFromMapsUrl('https://www.google.com/maps/place/%E0%A4%A/')).toBe('')
  })
})

describe('socialUrlProblem', () => {
  it("accepts each platform's own https hosts only, like the database", () => {
    expect(socialUrlProblem('facebook', 'https://www.facebook.com/claudex')).toBeNull()
    expect(socialUrlProblem('youtube', 'https://youtu.be/abc')).toBeNull()
    expect(socialUrlProblem('website', 'https://claudex.example.ph/about')).toBeNull()
    expect(socialUrlProblem('facebook', 'https://instagram.com/claudex')).toMatch(/^Facebook: use an https:\/\/ link/)
    expect(socialUrlProblem('facebook', 'https://facebook.com.evil.test/x')).not.toBeNull()
    expect(socialUrlProblem('facebook', 'https://evilfacebook.com/x')).not.toBeNull()
    expect(socialUrlProblem('facebook', 'https://facebook.com@evil.test')).not.toBeNull()
    expect(socialUrlProblem('instagram', 'http://instagram.com/claudex')).not.toBeNull()
    expect(socialUrlProblem('website', 'javascript:alert(1)')).not.toBeNull()
    expect(socialUrlProblem('website', `https://a.ph/${'a'.repeat(500)}`)).toMatch(/under 500/)
  })
})
