// T13.3: availability is asked for the current venue's slug; its query keys start with the venue id.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'

const h = vi.hoisted(() => ({ calls: [] as { fn: string; args: unknown }[] }))
vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: (fn: string, args: unknown) => { h.calls.push({ fn, args }); return Promise.resolve({ data: [], error: null }) } },
}))

import { fetchAvailability } from './api'
import { bookingKeys } from './hooks'

const VENUE = { id: 'b0000000-0000-4000-8000-0000000000b1', slug: 'bay-courts', status: 'active' as const }

beforeEach(() => {
  h.calls.length = 0
  setCurrentVenue(VENUE)
})

describe('booking api is venue-aware (T13.3)', () => {
  it('fetchAvailability sends the date and the current venue slug', async () => {
    await fetchAvailability('2030-05-01')
    expect(h.calls).toEqual([{ fn: 'get_availability', args: { p_date: '2030-05-01', p_venue_slug: 'bay-courts' } }])
  })

  it('availability keys start with the venue id and keep the date', () => {
    expect(bookingKeys.allAvailability()[0]).toBe(VENUE.id)
    expect(bookingKeys.availability('2030-05-01')[0]).toBe(VENUE.id)
    expect(JSON.stringify(bookingKeys.availability('2030-05-01'))).toContain('2030-05-01')
  })

  it('the other booking keys are unchanged', () => {
    expect(bookingKeys.platformFee).toEqual(['platform-fee'])
    expect(bookingKeys.allDetails).toEqual(['booking'])
    expect(bookingKeys.detail('abc', null)).toEqual(['booking', 'ABC', null])
  })
})
