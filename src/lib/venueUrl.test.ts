// T13.4: the admin URL of another venue, for the venue switcher.
import { describe, expect, it } from 'vitest'
import { venueAdminUrl } from './venueUrl'

const loc = (protocol: string, hostname: string, port = '') => ({ protocol, hostname, port })

describe('venueAdminUrl (T13.4)', () => {
  it('swaps the subdomain on a local venue host and keeps protocol and port', () => {
    expect(venueAdminUrl('b-venue', loc('http:', 'a-venue.localhost', '5179'))).toBe('http://b-venue.localhost:5179/admin')
  })

  it('swaps the subdomain on a plotline.fit venue host (https, no port)', () => {
    expect(venueAdminUrl('bay-courts', loc('https:', 'claudex-courts.plotline.fit'))).toBe('https://bay-courts.plotline.fit/admin')
  })

  it('bare localhost has no subdomain: same host with ?venue=', () => {
    expect(venueAdminUrl('bay-courts', loc('http:', 'localhost', '5173'))).toBe('/admin?venue=bay-courts')
  })

  it('a preview or Vercel host: same host with ?venue=', () => {
    expect(venueAdminUrl('bay-courts', loc('https:', 'court-booking-abc123.vercel.app'))).toBe('/admin?venue=bay-courts')
  })

  it('an IP address host: same host with ?venue=', () => {
    expect(venueAdminUrl('bay-courts', loc('http:', '192.168.1.20', '5173'))).toBe('/admin?venue=bay-courts')
  })
})
