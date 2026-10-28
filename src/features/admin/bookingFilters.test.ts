import { describe, expect, it } from 'vitest'
import { dayRangeLiteral, DEFAULT_FILTERS, effectiveSort, filtersFromParams, filtersToParams, parseSearch } from './bookingFilters'

describe('booking filters', () => {
  it('defaults to the review queue', () => {
    expect(filtersFromParams(new URLSearchParams())).toEqual(DEFAULT_FILTERS)
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe('')
  })

  it('round-trips through the URL', () => {
    const filters = { status: 'all', source: 'walk_in', date: '2030-01-07', q: 'ana santos', sort: 'booked-asc' } as const
    expect(filtersFromParams(filtersToParams(filters))).toEqual(filters)
    expect(filtersToParams(filters).toString()).toBe('status=all&source=walk_in&date=2030-01-07&q=ana+santos&sort=booked-asc')
  })

  it('ignores unknown values', () => {
    expect(filtersFromParams(new URLSearchParams('status=hacked&source=x&date=tomorrow&sort=price'))).toEqual(DEFAULT_FILTERS)
    expect(filtersFromParams(new URLSearchParams(`q=${'x'.repeat(150)}`)).q).toHaveLength(100)
  })

  it('builds a Manila-day range for overlap filtering', () => {
    expect(dayRangeLiteral('2030-01-07', 'Asia/Manila')).toBe('[2030-01-06T16:00:00.000Z,2030-01-07T16:00:00.000Z)')
  })

  it('sorts by play time, earliest first for a day and latest first otherwise, unless chosen', () => {
    expect(effectiveSort({ date: null, sort: null })).toBe('play-desc')
    expect(effectiveSort({ date: '2030-01-07', sort: null })).toBe('play-asc')
    expect(effectiveSort({ date: '2030-01-07', sort: 'booked-desc' })).toBe('booked-desc')
    // A search sets the date aside, so its default is latest first.
    expect(effectiveSort({ date: '2030-01-07', sort: null, q: 'ana' })).toBe('play-desc')
  })
})

describe('parseSearch (T11.5b)', () => {
  it('marks a whole reference code (with or without CB-, any case) and matches it exactly', () => {
    expect(parseSearch('CB-7KQ2XD')).toMatchObject({ kind: 'text', code: 'CB-7KQ2XD' })
    expect(parseSearch('  cb-7kq2xd ')).toMatchObject({ code: 'CB-7KQ2XD' })
    expect(parseSearch('7kq2xd')).toMatchObject({ code: 'CB-7KQ2XD' })
    const noDash = parseSearch('CB7KQ2XD') as { filter: string; code: string }
    expect(noDash.code).toBe('CB-7KQ2XD')
    expect(noDash.filter.startsWith('reference_code.eq.CB-7KQ2XD,')).toBe(true) // finds CB-7KQ2XD though ilike wouldn't
  })

  it('still searches names that look like a code, and everything else as part of a reference, name or email', () => {
    expect(parseSearch('Marcus')).toEqual({
      kind: 'text', code: 'CB-MARCUS',
      filter: 'reference_code.eq.CB-MARCUS,reference_code.ilike."*Marcus*",guest_name.ilike."*Marcus*",guest_email.ilike."*Marcus*"',
    })
    expect(parseSearch('7KQ')).toEqual({
      kind: 'text', code: null, filter: 'reference_code.ilike."*7KQ*",guest_name.ilike."*7KQ*",guest_email.ilike."*7KQ*"',
    })
    expect(parseSearch('  Ana   Santos ')).toMatchObject({ code: null, filter: expect.stringContaining('guest_name.ilike."*Ana Santos*"') })
    expect(parseSearch('ana@example.com')).toMatchObject({ filter: expect.stringContaining('guest_email.ilike."*ana@example.com*"') })
  })

  it('ignores text under 2 characters', () => {
    expect(parseSearch('')).toEqual({ kind: 'none' })
    expect(parseSearch(' a ')).toEqual({ kind: 'none' })
    expect(parseSearch('**')).toEqual({ kind: 'none' })
  })

  it('escapes filter syntax and LIKE wildcards, so the text is matched as written', () => {
    const { filter } = parseSearch('a,b) or(x"y') as { filter: string }
    expect(filter.split('guest_name')[0]).toBe('reference_code.ilike."*a,b) or(x\\"y*",')
    // % and _ become literal (\% and \_ for LIKE, then the backslash is escaped inside the quotes); * is dropped.
    expect((parseSearch('50%_off*') as { filter: string }).filter).toContain('guest_name.ilike."*50\\\\%\\\\_off*"')
  })
})
