// T33.3: /book/checkout carries one run (the old court/start/slots form) or 2-6 repeated `run=<court>,<start>,<slots>` params.
import { describe, expect, it } from 'vitest'
import { parseCheckoutRuns, parseCheckoutSearch, toCheckoutSearch, toRunsSearch, type CheckoutRun } from './checkoutParams'

const C1 = '3f1c2b9e-1d2a-4c3b-8e7f-0a1b2c3d4e5f'
const C2 = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'
// 2030-01-07 Manila: 10 AM = 02:00Z, 7 AM = 23:00Z the day before.
const T10 = '2030-01-07T02:00:00.000Z'
const T14 = '2030-01-07T06:00:00.000Z'
const EARLY = '2030-01-06T23:00:00.000Z'
const run = (courtId: string, start: string, slots = 1): CheckoutRun => ({ courtId, start, slots })
const parse = (query: string) => parseCheckoutRuns(new URLSearchParams(query))

describe('toRunsSearch', () => {
  it('one run gives exactly the old court/start/slots form', () => {
    const one = run(C1, T10, 2)
    expect(toRunsSearch([one])).toBe(toCheckoutSearch(one))
    expect(toRunsSearch([one])).toBe(new URLSearchParams({ court: C1, start: T10, slots: '2' }).toString())
  })

  it('two or more runs give one repeated run param each, in the order given', () => {
    const search = toRunsSearch([run(C2, T14, 1), run(C1, T10, 2)])
    const params = new URLSearchParams(search)
    expect(params.getAll('run')).toEqual([`${C2},${T14},1`, `${C1},${T10},2`])
    expect(params.has('court')).toBe(false)
    expect(params.has('start')).toBe(false)
    expect(params.has('slots')).toBe(false)
  })

  it('URL-encodes the commas and colons of a run', () => {
    const search = toRunsSearch([run(C1, T10, 1), run(C2, T14, 1)])
    expect(search).not.toContain(',')
    expect(search).toContain('run=')
  })
})

describe('parseCheckoutRuns', () => {
  it('without run params it behaves like parseCheckoutSearch (the old single-court link)', () => {
    const old = toCheckoutSearch(run(C1, T10, 2))
    expect(parse(old)).toEqual([run(C1, T10, 2)])
    expect(parse(old)).toEqual([parseCheckoutSearch(new URLSearchParams(old))])
    expect(parse('')).toBeNull()
    expect(parse(`court=nope&start=${T10}&slots=2`)).toBeNull()
  })

  it('keeps the rebook parameter out of the way: an old link with rebook still parses as one run', () => {
    expect(parse(toCheckoutSearch({ ...run(C1, T10, 1), rebook: 'CB-7KQ2XD' }))).toEqual([run(C1, T10, 1)])
  })

  it('round-trips several runs on different courts, in order', () => {
    const runs = [run(C2, T14, 1), run(C1, T10, 2)]
    expect(parse(toRunsSearch(runs))).toEqual(runs)
  })

  it('round-trips two runs on one court that do not overlap (early morning and late night)', () => {
    const night = '2030-01-07T14:00:00.000Z' // 10 PM Manila
    const runs = [run(C1, EARLY, 1), run(C1, night, 2)]
    expect(parse(toRunsSearch(runs))).toEqual(runs)
  })

  it('touching runs on one court do not overlap, so they parse', () => {
    expect(parse(toRunsSearch([run(C1, T10, 2), run(C1, '2030-01-07T04:00:00.000Z', 1)]))).toHaveLength(2)
  })

  it('normalises each start to ISO like parseCheckoutSearch', () => {
    const parsed = parse(`run=${C1},2030-01-07T10:00:00%2B08:00,1&run=${C2},2030-01-07T14:00:00%2B08:00,1`)
    expect(parsed).toEqual([run(C1, '2030-01-07T02:00:00.000Z', 1), run(C2, '2030-01-07T06:00:00.000Z', 1)])
  })

  it('accepts exactly 6 runs and rejects 7', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => run(C1, new Date(Date.parse(T10) + i * 2 * 3_600_000).toISOString(), 1))
    expect(parse(toRunsSearch(many(6)))).toHaveLength(6)
    expect(parse(toRunsSearch(many(7)))).toBeNull()
  })

  it('a single run param is not a valid group (needs 2 to 6)', () => {
    expect(parse(`run=${C1},${T10},1`)).toBeNull()
  })

  it('rejects malformed runs', () => {
    const ok = `run=${C2},${T14},1`
    expect(parse(`run=not-a-uuid,${T10},1&${ok}`)).toBeNull()
    expect(parse(`run=${C1},yesterday,1&${ok}`)).toBeNull()
    expect(parse(`run=${C1},${T10},0&${ok}`)).toBeNull()
    expect(parse(`run=${C1},${T10},25&${ok}`)).toBeNull()
    expect(parse(`run=${C1},${T10},1.5&${ok}`)).toBeNull()
    expect(parse(`run=${C1},${T10}&${ok}`)).toBeNull()
    expect(parse(`run=${C1}&${ok}`)).toBeNull()
    expect(parse(`run=&${ok}`)).toBeNull()
  })

  it('rejects runs that overlap on one court', () => {
    // 10 AM for 2 hours covers 10-12; a run at 11 AM overlaps it, in either order.
    const t11 = '2030-01-07T03:00:00.000Z'
    expect(parse(toRunsSearch([run(C1, T10, 2), run(C1, t11, 1)]))).toBeNull()
    expect(parse(toRunsSearch([run(C1, t11, 1), run(C1, T10, 2)]))).toBeNull()
    expect(parse(toRunsSearch([run(C1, T10, 1), run(C1, T10, 1)]))).toBeNull()
  })

  it('the same time on two different courts is fine', () => {
    expect(parse(toRunsSearch([run(C1, T10, 2), run(C2, T10, 2)]))).toHaveLength(2)
  })
})
