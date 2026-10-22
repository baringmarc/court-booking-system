import { describe, expect, it } from 'vitest'
import { shownAmenities } from './amenities'
import type { Amenity } from './api'
import { mapEmbedUrl, mapQueryOf, mapsSearchUrl } from './map'
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

describe('map URLs', () => {
  it('uses the official embed with a key and the keyless one without', () => {
    expect(mapEmbedUrl('Claudex Courts, Makati', 'k&1')).toBe('https://www.google.com/maps/embed/v1/place?key=k%261&q=Claudex%20Courts%2C%20Makati')
    expect(mapEmbedUrl(' Claudex Courts ')).toBe('https://www.google.com/maps?q=Claudex%20Courts&output=embed')
    expect(mapsSearchUrl('123 Rizal Ave')).toBe('https://www.google.com/maps/search/?api=1&query=123%20Rizal%20Ave')
  })

  it('searches the map query, or the address when there is none', () => {
    expect(mapQueryOf({ address: '123 Rizal Ave', maps_query: ' ' })).toBe('123 Rizal Ave')
    expect(mapQueryOf({ address: '123 Rizal Ave', maps_query: 'Claudex Courts' })).toBe('Claudex Courts')
    expect(mapQueryOf({ address: '', maps_query: '' })).toBe('')
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
