// T30.4: the `rebook` reference on the checkout URL ("Same time next week", SPEC §6 create_booking / §8).
import { describe, expect, it } from 'vitest'
import { rebookLink } from '../../../supabase/functions/_shared/rebookLink'
import { parseCheckoutSearch, parseRebookReference, toCheckoutSearch } from './checkoutParams'

const valid = { courtId: '3f1c2b9e-1d2a-4c3b-8e7f-0a1b2c3d4e5f', start: '2030-01-07T10:00:00.000Z', slots: 2 }

describe('toCheckoutSearch with rebook', () => {
  it('leaves the existing output unchanged when no rebook is given', () => {
    const search = new URLSearchParams(toCheckoutSearch(valid))
    expect([...search.keys()]).toEqual(['court', 'start', 'slots'])
    expect(search.has('rebook')).toBe(false)
  })

  it('appends rebook=<reference> when set', () => {
    const search = new URLSearchParams(toCheckoutSearch({ ...valid, rebook: 'CB-7KQ2XD' }))
    expect(search.get('rebook')).toBe('CB-7KQ2XD')
    expect(search.get('court')).toBe(valid.courtId)
    expect(search.get('start')).toBe(valid.start)
    expect(search.get('slots')).toBe('2')
  })

  it('does not append an undefined rebook', () => {
    expect(new URLSearchParams(toCheckoutSearch({ ...valid, rebook: undefined })).has('rebook')).toBe(false)
  })
})

describe('parseRebookReference', () => {
  it('returns the reference', () => {
    expect(parseRebookReference(new URLSearchParams({ rebook: 'CB-7KQ2XD' }))).toBe('CB-7KQ2XD')
  })

  it('trims the value', () => {
    expect(parseRebookReference(new URLSearchParams({ rebook: '  CB-7KQ2XD ' }))).toBe('CB-7KQ2XD')
  })

  it('is null when absent or blank', () => {
    expect(parseRebookReference(new URLSearchParams())).toBeNull()
    expect(parseRebookReference(new URLSearchParams({ rebook: '' }))).toBeNull()
    expect(parseRebookReference(new URLSearchParams({ rebook: '   ' }))).toBeNull()
  })
})

describe('parseCheckoutSearch with rebook in the URL', () => {
  it('still returns exactly court, start and slots', () => {
    const search = new URLSearchParams(toCheckoutSearch({ ...valid, rebook: 'CB-7KQ2XD' }))
    const parsed = parseCheckoutSearch(search)
    expect(parsed).toEqual(valid)
    expect(Object.keys(parsed ?? {}).sort()).toEqual(['courtId', 'slots', 'start'])
  })
})

describe('the email link and the app agree', () => {
  it("the URL rebookLink builds parses to the same court, start, slots and reference", () => {
    const url = rebookLink({
      site: 'https://claudex-courts.example',
      data: { court_id: valid.courtId, slots: 2, starts_at: '2030-01-07T10:00:00.000Z', reference_code: 'CB-7KQ2XD' },
    })
    expect(url).not.toBeNull()
    const parsed = new URL(url ?? '')
    expect(parsed.pathname).toBe('/book/checkout')
    expect(parseCheckoutSearch(parsed.searchParams)).toEqual({ courtId: valid.courtId, start: '2030-01-14T10:00:00.000Z', slots: 2 })
    expect(parseRebookReference(parsed.searchParams)).toBe('CB-7KQ2XD')
  })
})
