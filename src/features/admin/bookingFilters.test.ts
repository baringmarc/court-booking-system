import { describe, expect, it } from 'vitest'
import { dayRangeLiteral, DEFAULT_FILTERS, filtersFromParams, filtersToParams } from './bookingFilters'

describe('booking filters', () => {
  it('defaults to the review queue', () => {
    expect(filtersFromParams(new URLSearchParams())).toEqual(DEFAULT_FILTERS)
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe('')
  })

  it('round-trips through the URL', () => {
    const filters = { status: 'all', source: 'walk_in', date: '2030-01-07' } as const
    expect(filtersFromParams(filtersToParams(filters))).toEqual(filters)
  })

  it('ignores unknown values', () => {
    expect(filtersFromParams(new URLSearchParams('status=hacked&source=x&date=tomorrow'))).toEqual(DEFAULT_FILTERS)
  })

  it('builds a Manila-day range for overlap filtering', () => {
    expect(dayRangeLiteral('2030-01-07', 'Asia/Manila')).toBe('[2030-01-06T16:00:00.000Z,2030-01-07T16:00:00.000Z)')
  })
})
