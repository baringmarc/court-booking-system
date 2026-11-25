// T33.4: fetchMyBookings reads bookings.booking_group_id and returns it on each row (null when the booking is alone).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'

const h = vi.hoisted(() => ({ selects: [] as string[], rows: [] as unknown[] }))

vi.mock('../../lib/supabase', () => {
  const builder = () => {
    const chain: Record<string, unknown> = {}
    chain.select = (columns: string) => { h.selects.push(columns); return chain }
    for (const m of ['eq', 'order', 'limit']) chain[m] = () => chain
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: h.rows, error: null }).then(resolve)
    return chain
  }
  return { supabase: { from: builder } }
})

import { fetchMyBookings } from './api'

const row = (id: string, group: string | null) => ({
  id, reference_code: `CB-${id}`, during: '["2030-01-06 23:00:00+00","2030-01-07 00:00:00+00")', status: 'confirmed', expires_at: null,
  amount_due: '360.00', parent_booking_id: null, created_at: '2030-01-01T00:00:00+00:00', booking_group_id: group,
  courts: { name: 'Badminton 1', sport: 'badminton' },
})

beforeEach(() => {
  h.selects.length = 0
  h.rows = [row('LEAD01', 'g1'), row('SOLO09', null)]
  setCurrentVenue({ id: 'venue-a', slug: 'a-venue', status: 'active' })
})

describe('fetchMyBookings (T33.4)', () => {
  it('selects booking_group_id', async () => {
    await fetchMyBookings('u1')
    expect(h.selects[0]).toContain('booking_group_id')
  })

  it('returns booking_group_id on each row, null for a booking alone, and the rest as before', async () => {
    const rows = await fetchMyBookings('u1')
    expect(rows.map((r) => r.booking_group_id)).toEqual(['g1', null])
    expect(rows[0]).toMatchObject({ reference_code: 'CB-LEAD01', court_name: 'Badminton 1', amount_due: 360, status: 'confirmed' })
    expect(rows[0].courts).toBeUndefined()
  })
})
