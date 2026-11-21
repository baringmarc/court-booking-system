// T30.3: the "Same time next week" link the confirmation and reminder emails carry (the same query as
// src/features/booking/checkoutParams.ts plus the reference of the booking being repeated).
import { describe, expect, it } from 'vitest'
import { parseCheckoutSearch } from '../../../src/features/booking/checkoutParams.ts'
import { rebookLink } from './rebookLink.ts'

const COURT = '3f1c2a9e-7b4d-4c1e-9a55-0d2e6b8f1a42'
const data = { court_id: COURT, slots: 2, starts_at: '2030-01-07T10:00:00+00:00', reference_code: 'CB-7KQ2XD' }
const site = 'https://claudex.example'

describe('rebookLink', () => {
  it('points at checkout with the same court and slots, the start plus 7 days (UTC) and the reference, in that order', () => {
    expect(rebookLink({ site, data })).toBe(
      `https://claudex.example/book/checkout?court=${COURT}&start=2030-01-14T10%3A00%3A00.000Z&slots=2&rebook=CB-7KQ2XD`,
    )
  })

  it('strips trailing slashes from the site', () => {
    expect(rebookLink({ site: 'https://claudex.example/', data })).toBe(rebookLink({ site, data }))
    expect(rebookLink({ site: 'https://claudex.example///', data })).toBe(rebookLink({ site, data }))
  })

  it('adds exactly 7 days of real time whatever the offset of the stored start', () => {
    // 6:00 PM Manila written with its own offset is the same instant.
    expect(rebookLink({ site, data: { ...data, starts_at: '2030-01-07T18:00:00+08:00' } })).toBe(rebookLink({ site, data }))
    // 7:30 AM in Manila on Jan 7 is Jan 6 in UTC; a week later is Jan 13 23:30 UTC (Jan 14, 7:30 AM in Manila).
    const early = rebookLink({ site, data: { ...data, starts_at: '2030-01-06T23:30:00.000Z' } })
    expect(new URL(early!).searchParams.get('start')).toBe('2030-01-13T23:30:00.000Z')
    // 11:30 PM in Manila (15:30 UTC).
    const late = rebookLink({ site, data: { ...data, starts_at: '2030-01-07T15:30:00.000Z' } })
    expect(new URL(late!).searchParams.get('start')).toBe('2030-01-14T15:30:00.000Z')
  })

  it('crosses a month and a year end', () => {
    const link = rebookLink({ site, data: { ...data, starts_at: '2030-12-28T02:00:00.000Z' } })
    expect(new URL(link!).searchParams.get('start')).toBe('2031-01-04T02:00:00.000Z')
  })

  it('is null when the snapshot has no court_id or no usable slots (an email queued before T30.2)', () => {
    expect(rebookLink({ site, data: { ...data, court_id: undefined } })).toBeNull()
    expect(rebookLink({ site, data: { ...data, court_id: '' } })).toBeNull()
    expect(rebookLink({ site, data: { ...data, slots: undefined } })).toBeNull()
    expect(rebookLink({ site, data: { ...data, slots: 0 } })).toBeNull()
    expect(rebookLink({ site, data: { ...data, slots: -1 } })).toBeNull()
    expect(rebookLink({ site, data: { ...data, slots: 1.5 } })).toBeNull()
    expect(rebookLink({ site, data: { ...data, slots: Number.NaN } })).toBeNull()
  })

  it('is a query the checkout page accepts, and it reads back as the start plus 7 days', () => {
    const link = rebookLink({ site, data })
    expect(link).not.toBeNull()
    const url = new URL(link!)
    expect(url.pathname).toBe('/book/checkout')
    expect(parseCheckoutSearch(new URLSearchParams(url.search))).toEqual({ courtId: COURT, start: '2030-01-14T10:00:00.000Z', slots: 2 })
    expect(url.searchParams.get('rebook')).toBe('CB-7KQ2XD')
  })

  it('carries a single slot too', () => {
    const link = rebookLink({ site, data: { ...data, slots: 1 } })
    expect(new URL(link!).searchParams.get('slots')).toBe('1')
  })
})
