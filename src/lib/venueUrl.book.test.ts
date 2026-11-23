// T31.1: the public booking page's address, as text for a caption (absolute, unlike venueAdminUrl's relative fallback).
import { describe, expect, it } from 'vitest'
import { venueBookUrl } from './venueUrl'

const loc = (protocol: string, hostname: string, port = '') => ({ protocol, hostname, port })

describe('venueBookUrl (T31.1)', () => {
  it('a plotline.fit venue host: the venue subdomain, https, no port', () => {
    expect(venueBookUrl('bay-courts', loc('https:', 'claudex-courts.plotline.fit'))).toBe('https://bay-courts.plotline.fit/book')
  })

  it('a local venue host keeps protocol and port', () => {
    expect(venueBookUrl('b-venue', loc('http:', 'a-venue.localhost', '5179'))).toBe('http://b-venue.localhost:5179/book')
  })

  it('bare localhost: the same host and port, absolute, with ?venue=', () => {
    expect(venueBookUrl('bay-courts', loc('http:', 'localhost', '5173'))).toBe('http://localhost:5173/book?venue=bay-courts')
  })

  it('a Vercel host without a port: ?venue=', () => {
    expect(venueBookUrl('bay-courts', loc('https:', 'court-booking-abc123.vercel.app'))).toBe('https://court-booking-abc123.vercel.app/book?venue=bay-courts')
  })

  it('an IP address host: ?venue=', () => {
    expect(venueBookUrl('bay-courts', loc('http:', '192.168.1.20', '5173'))).toBe('http://192.168.1.20:5173/book?venue=bay-courts')
  })

  it('encodes the slug in the ?venue= form', () => {
    expect(venueBookUrl('a b&c', loc('https:', 'x.vercel.app'))).toBe('https://x.vercel.app/book?venue=a%20b%26c')
  })

  it('the host match is case-insensitive', () => {
    expect(venueBookUrl('bay-courts', loc('https:', 'Claudex-Courts.Plotline.Fit'))).toBe('https://bay-courts.plotline.fit/book')
  })
})
