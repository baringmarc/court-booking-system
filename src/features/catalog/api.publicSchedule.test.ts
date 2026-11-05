import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'

const h = vi.hoisted(() => ({ ranges: [] as [number, number][], rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: h.rpc } }))
import { fetchPublicSchedule, type PublicSchedulePeriod } from './api'

beforeEach(() => {
  h.ranges.length = 0
  setCurrentVenue({ id: 'a', slug: 'venue', status: 'active' })
})

describe('fetchPublicSchedule', () => {
  it('retrieves every page when the venue has more than 1000 periods', async () => {
    const rows: PublicSchedulePeriod[] = Array.from({ length: 1023 }, (_, i) => ({
      court_id: String(i), operating_date: '2030-01-01', period_start: '2030-01-01T00:00:00Z',
      period_end: '2030-01-01T01:00:00Z', booking_start: '2030-01-01', booking_end: '2030-01-31',
    }))
    h.rpc.mockImplementation(() => ({ range: (from: number, to: number) => {
      h.ranges.push([from, to])
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
    } }))
    expect(await fetchPublicSchedule()).toEqual(rows)
    expect(h.ranges).toEqual([[0, 999], [1000, 1999]])
    expect(h.rpc).toHaveBeenCalledWith('get_public_schedule', { p_venue_slug: 'venue' })
  })
})
