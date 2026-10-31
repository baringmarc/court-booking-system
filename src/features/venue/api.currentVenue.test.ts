// T13.3: public venue reads are scoped to the current venue; fetchVenueBySlug looks the venue up by slug.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'

const h = vi.hoisted(() => ({
  ops: [] as { table: string; selected?: string; eqs: [string, unknown][]; maybe: boolean }[],
  maybeData: null as unknown,
}))

vi.mock('../../lib/supabase', () => {
  const builder = (table: string) => {
    const rec = { table, selected: undefined as string | undefined, eqs: [] as [string, unknown][], maybe: false }
    h.ops.push(rec)
    const chain: Record<string, unknown> = {}
    chain.select = (s: string) => { rec.selected = s; return chain }
    chain.eq = (c: string, v: unknown) => { rec.eqs.push([c, v]); return chain }
    chain.order = () => chain
    chain.maybeSingle = () => { rec.maybe = true; return Promise.resolve({ data: h.maybeData, error: null }) }
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
    return chain
  }
  return { supabase: { from: builder, storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) } } }
})

import { fetchAmenities, fetchInfoSections, fetchPaymentAccounts, fetchSocialLinks, fetchVenueBySlug, venueKeys } from './api'

const VENUE = { id: 'b0000000-0000-4000-8000-0000000000b1', slug: 'bay-courts', status: 'active' as const }

beforeEach(() => {
  h.ops.length = 0
  h.maybeData = null
  setCurrentVenue(VENUE)
})

describe('fetchVenueBySlug (T13.3)', () => {
  it('looks the venue up by slug with only the fields the app needs', async () => {
    h.maybeData = VENUE
    await expect(fetchVenueBySlug('bay-courts')).resolves.toEqual(VENUE)
    const op = h.ops[0]
    expect(op.table).toBe('venues')
    expect(op.selected?.replace(/\s/g, '')).toBe('id,slug,status')
    expect(op.eqs).toContainEqual(['slug', 'bay-courts'])
    expect(op.maybe).toBe(true)
  })

  it('returns null when RLS hides the venue (not active for an anon caller)', async () => {
    h.maybeData = null
    await expect(fetchVenueBySlug('hidden-venue')).resolves.toBeNull()
  })
})

describe('public venue reads send the venue id (T13.3)', () => {
  it.each([
    ['venue_social_links', fetchSocialLinks],
    ['venue_info_sections', fetchInfoSections],
    ['venue_amenities', fetchAmenities],
    ['venue_payment_accounts', fetchPaymentAccounts],
  ])('%s filters on venue_id', async (table, fn) => {
    await fn()
    const op = h.ops.find((o) => o.table === table)!
    expect(op.eqs).toContainEqual(['venue_id', VENUE.id])
  })
})

describe('venueKeys (T13.3)', () => {
  it('every key starts with the current venue id', () => {
    for (const key of [venueKeys.socials(), venueKeys.sections(), venueKeys.amenities(), venueKeys.paymentAccounts()]) {
      expect(key[0]).toBe(VENUE.id)
    }
  })

  it('keys differ per venue and per list', () => {
    const before = venueKeys.socials()
    setCurrentVenue({ ...VENUE, id: 'b0000000-0000-4000-8000-0000000000b2' })
    expect(venueKeys.socials()).not.toEqual(before)
    expect(venueKeys.socials()).not.toEqual(venueKeys.sections())
  })
})
