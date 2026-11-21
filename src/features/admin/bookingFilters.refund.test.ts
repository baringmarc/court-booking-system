// T30.6: the "Refund owed" filter lives in the URL as refund=owed, after the existing params.
import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTERS, filtersFromParams, filtersToParams } from './bookingFilters'

describe('refund filter (T30.6)', () => {
  it('reads refund=owed', () => {
    expect(filtersFromParams(new URLSearchParams('status=all&refund=owed'))).toMatchObject({ status: 'all', refund: 'owed' })
  })

  it('leaves the key out for anything else, or when absent', () => {
    for (const query of ['', 'refund=', 'refund=settled', 'refund=OWED', 'refund=all', 'refund=owed%20']) {
      const filters = filtersFromParams(new URLSearchParams(query))
      expect('refund' in filters, `"${query}"`).toBe(false)
    }
  })

  it('writes refund=owed after the other params, so a link reads status=all&refund=owed', () => {
    expect(filtersToParams({ ...DEFAULT_FILTERS, status: 'all', refund: 'owed' }).toString()).toBe('status=all&refund=owed')
    expect(filtersToParams({ ...DEFAULT_FILTERS, status: 'all', source: 'walk_in', date: '2030-01-07', q: 'ana', sort: 'booked-asc', refund: 'owed' }).toString())
      .toBe('status=all&source=walk_in&date=2030-01-07&q=ana&sort=booked-asc&refund=owed')
  })

  it('writes nothing for no refund filter', () => {
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe('')
    expect(filtersToParams({ ...DEFAULT_FILTERS, status: 'all' }).toString()).toBe('status=all')
  })

  it('round-trips through the URL', () => {
    const filters = { ...DEFAULT_FILTERS, status: 'all' as const, refund: 'owed' as const }
    expect(filtersFromParams(filtersToParams(filters))).toEqual(filters)
  })
})
