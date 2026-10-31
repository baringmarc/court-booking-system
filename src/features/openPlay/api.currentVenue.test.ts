// T13.3: open play reads are scoped to the current venue.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'

const h = vi.hoisted(() => ({ eqs: [] as [string, unknown][] }))
vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  chain.eq = (c: string, v: unknown) => { h.eqs.push([c, v]); return chain }
  for (const m of ['select', 'gt', 'order']) chain[m] = () => chain
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
  return { supabase: { from: () => chain } }
})

import { fetchUpcomingOpenPlay, openPlayKeys } from './api'

const VENUE = { id: 'b0000000-0000-4000-8000-0000000000b1', slug: 'bay-courts', status: 'active' as const }

beforeEach(() => {
  h.eqs.length = 0
  setCurrentVenue(VENUE)
})

describe('open play api is venue-aware (T13.3)', () => {
  it('fetchUpcomingOpenPlay filters on venue_id', async () => {
    await fetchUpcomingOpenPlay()
    expect(h.eqs).toContainEqual(['venue_id', VENUE.id])
  })

  it('keys start with the venue id', () => {
    expect(openPlayKeys.all()[0]).toBe(VENUE.id)
    expect(openPlayKeys.upcoming()[0]).toBe(VENUE.id)
    expect(openPlayKeys.upcoming()).not.toEqual(openPlayKeys.all())
  })
})
