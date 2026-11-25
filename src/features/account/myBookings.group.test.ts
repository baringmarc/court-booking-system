// T33.4: My bookings shows a checkout's courts as one row. collapseGroups turns the rows of one booking group into ONE
// row (the earliest-starting court's, with `courts` = every row of the group) before splitMyBookings sorts and splits
// the list. Rows without a group pass through unchanged, in order.
import { describe, expect, it } from 'vitest'
import { groupDisplayStatus } from '../booking/group'
import { displayStatus } from '../booking/status'
import type { MyBooking } from './api'
import { collapseGroups, splitMyBookings } from './myBookings'

// 2030-01-07 04:00 in Manila (the early morning is the previous UTC day).
const NOW = new Date('2030-01-06T20:00:00.000Z')

const row = (ref: string, startIso: string, overrides: Partial<MyBooking> = {}): MyBooking => ({
  id: ref, reference_code: ref, court_name: 'Court', sport: 'badminton',
  slot_start: startIso, slot_end: new Date(Date.parse(startIso) + 3_600_000).toISOString(),
  status: 'confirmed', expires_at: null, amount_due: 350, parent_booking_id: null, created_at: '2030-01-01T00:00:00.000Z', ...overrides,
})
const inGroup = (ref: string, startIso: string, overrides: Partial<MyBooking> = {}) => row(ref, startIso, { booking_group_id: 'g1', ...overrides })

describe('collapseGroups', () => {
  it('passes rows without a group through unchanged, in their order', () => {
    const rows = [row('B', '2030-01-09T10:00:00.000Z'), row('A', '2030-01-08T10:00:00.000Z', { booking_group_id: null }), row('C', '2030-01-07T10:00:00.000Z')]
    expect(collapseGroups(rows)).toEqual(rows)
    expect(collapseGroups(rows).map((r) => r.reference_code)).toEqual(['B', 'A', 'C'])
  })

  it('makes one row of a group: the earliest-starting court’s row with every court in `courts`, sorted by start then reference', () => {
    const late = inGroup('CB-LATE02', '2030-01-07T15:00:00.000Z', { court_name: 'Tennis Court', amount_due: 700, slot_end: '2030-01-07T17:00:00.000Z' })
    const early = inGroup('CB-EARLY1', '2030-01-06T23:00:00.000Z', { court_name: 'Badminton 1', amount_due: 360 })
    const other = row('CB-SOLO09', '2030-01-08T10:00:00.000Z')
    const out = collapseGroups([late, other, early])
    const collapsed = out.find((r) => r.courts)!
    expect(collapsed.reference_code).toBe('CB-EARLY1')
    expect(collapsed.id).toBe('CB-EARLY1')
    expect(collapsed.court_name).toBe('Badminton 1')
    expect(collapsed.courts!.map((c) => c.reference_code)).toEqual(['CB-EARLY1', 'CB-LATE02'])
    expect(out).toHaveLength(2)
    expect(out.find((r) => r.reference_code === 'CB-SOLO09')?.courts).toBeUndefined()
  })

  it('sums amount_due and spans the earliest start to the latest end of the courts that are not cancelled', () => {
    const out = collapseGroups([
      inGroup('CB-EARLY1', '2030-01-06T23:00:00.000Z', { amount_due: 360 }),
      inGroup('CB-LATE02', '2030-01-07T15:00:00.000Z', { amount_due: 700, slot_end: '2030-01-07T17:00:00.000Z' }),
      // Cancelled, and later than both: it must not stretch the span.
      inGroup('CB-GONE03', '2030-01-09T10:00:00.000Z', { amount_due: 100, status: 'cancelled', slot_end: '2030-01-09T11:00:00.000Z' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].amount_due).toBe(1160)
    expect(out[0].slot_start).toBe('2030-01-06T23:00:00.000Z')
    expect(out[0].slot_end).toBe('2030-01-07T17:00:00.000Z')
    expect(out[0].courts).toHaveLength(3)
  })

  it('uses every court for the span when all are cancelled', () => {
    const out = collapseGroups([
      inGroup('CB-A', '2030-01-06T23:00:00.000Z', { status: 'cancelled' }),
      inGroup('CB-B', '2030-01-07T15:00:00.000Z', { status: 'cancelled', slot_end: '2030-01-07T17:00:00.000Z' }),
    ])
    expect(out[0].slot_start).toBe('2030-01-06T23:00:00.000Z')
    expect(out[0].slot_end).toBe('2030-01-07T17:00:00.000Z')
    expect(displayStatus(out[0], NOW)).toBe('cancelled')
  })

  it('takes the earliest court’s row even when it is cancelled, and breaks a tie on start by reference', () => {
    const out = collapseGroups([
      inGroup('CB-ZED', '2030-01-06T23:00:00.000Z'),
      inGroup('CB-ABC', '2030-01-06T23:00:00.000Z'),
    ])
    expect(out[0].reference_code).toBe('CB-ABC')
    expect(out[0].courts!.map((c) => c.reference_code)).toEqual(['CB-ABC', 'CB-ZED'])
    const cancelledFirst = collapseGroups([
      inGroup('CB-EARLY1', '2030-01-06T23:00:00.000Z', { status: 'cancelled' }),
      inGroup('CB-LATE02', '2030-01-07T15:00:00.000Z', { status: 'confirmed' }),
    ])
    expect(cancelledFirst[0].reference_code).toBe('CB-EARLY1')
    expect(cancelledFirst[0].status).toBe('confirmed')
  })

  it('shows the group’s status: displayStatus of the collapsed row equals groupDisplayStatus of its courts', () => {
    const cases: MyBooking[][] = [
      [inGroup('A', '2030-01-06T23:00:00.000Z', { status: 'pending_payment', expires_at: '2030-01-06T20:30:00.000Z' }), inGroup('B', '2030-01-07T15:00:00.000Z', { status: 'pending_payment', expires_at: '2030-01-06T20:30:00.000Z' })],
      [inGroup('A', '2030-01-06T23:00:00.000Z', { status: 'payment_submitted' }), inGroup('B', '2030-01-07T15:00:00.000Z', { status: 'payment_submitted' })],
      [inGroup('A', '2030-01-06T23:00:00.000Z', { status: 'confirmed' }), inGroup('B', '2030-01-07T15:00:00.000Z', { status: 'cancelled' })],
      // One court played, one ahead: confirmed. Both played: completed.
      [inGroup('A', '2030-01-06T01:00:00.000Z', { status: 'confirmed' }), inGroup('B', '2030-01-07T15:00:00.000Z', { status: 'confirmed' })],
      [inGroup('A', '2030-01-06T01:00:00.000Z', { status: 'confirmed' }), inGroup('B', '2030-01-06T05:00:00.000Z', { status: 'confirmed' })],
      // An expired hold next to a rejected court.
      [inGroup('A', '2030-01-06T23:00:00.000Z', { status: 'pending_payment', expires_at: '2030-01-06T19:00:00.000Z' }), inGroup('B', '2030-01-07T15:00:00.000Z', { status: 'rejected' })],
    ]
    for (const rows of cases) {
      const [collapsed] = collapseGroups(rows)
      expect(displayStatus(collapsed, NOW)).toBe(groupDisplayStatus(rows, NOW))
    }
  })

  it('takes the status and expires_at of the first court that shows the group’s status', () => {
    // The first court has no hold left; the second is still waiting. The group is waiting, with the second’s hold.
    const out = collapseGroups([
      inGroup('A', '2030-01-06T23:00:00.000Z', { status: 'confirmed' }),
      inGroup('B', '2030-01-07T15:00:00.000Z', { status: 'pending_payment', expires_at: '2030-01-06T20:30:00.000Z' }),
    ])
    expect(out[0].reference_code).toBe('A')
    expect(out[0].status).toBe('pending_payment')
    expect(out[0].expires_at).toBe('2030-01-06T20:30:00.000Z')
  })

  it('keeps separate groups separate and leaves a group of one court as a row with one court', () => {
    const out = collapseGroups([
      row('X1', '2030-01-06T23:00:00.000Z', { booking_group_id: 'g1' }),
      row('Y1', '2030-01-07T15:00:00.000Z', { booking_group_id: 'g2' }),
      row('Y2', '2030-01-07T16:00:00.000Z', { booking_group_id: 'g2' }),
    ])
    expect(out).toHaveLength(2)
    expect(out.find((r) => r.reference_code === 'Y1')?.courts).toHaveLength(2)
    expect(out.find((r) => r.reference_code === 'X1')?.courts?.length ?? 1).toBe(1)
  })
})

describe('collapseGroups with splitMyBookings', () => {
  it('is upcoming while any court still holds its slot and has not ended, otherwise past', () => {
    const upcoming = splitMyBookings(collapseGroups([
      inGroup('A', '2030-01-06T01:00:00.000Z', { status: 'confirmed' }),
      inGroup('B', '2030-01-07T15:00:00.000Z', { status: 'confirmed', slot_end: '2030-01-07T17:00:00.000Z' }),
    ]), NOW)
    expect(upcoming.upcoming.map((r) => r.reference_code)).toEqual(['A'])
    expect(upcoming.past).toEqual([])

    const past = splitMyBookings(collapseGroups([
      inGroup('A', '2030-01-06T01:00:00.000Z', { status: 'confirmed' }),
      inGroup('B', '2030-01-06T05:00:00.000Z', { status: 'confirmed' }),
    ]), NOW)
    expect(past.upcoming).toEqual([])
    expect(past.past.map((r) => r.reference_code)).toEqual(['A'])

    const cancelled = splitMyBookings(collapseGroups([
      inGroup('A', '2030-01-06T23:00:00.000Z', { status: 'cancelled' }),
      inGroup('B', '2030-01-07T15:00:00.000Z', { status: 'cancelled' }),
    ]), NOW)
    expect(cancelled.upcoming).toEqual([])
    expect(cancelled.past).toHaveLength(1)
  })

  it('sorts by the earliest active start, so a played or cancelled first court does not pull it up the list', () => {
    // The group's first court is cancelled and starts first; its live court is on Jan 9, after the single booking on Jan 8.
    const rows = collapseGroups([
      inGroup('G-CANC', '2030-01-06T23:00:00.000Z', { status: 'cancelled' }),
      inGroup('G-LIVE', '2030-01-09T10:00:00.000Z', { status: 'confirmed' }),
      row('SOLO', '2030-01-08T10:00:00.000Z'),
    ])
    const { upcoming } = splitMyBookings(rows, NOW)
    expect(upcoming.map((r) => r.slot_start)).toEqual(['2030-01-08T10:00:00.000Z', '2030-01-09T10:00:00.000Z'])
    expect(upcoming.map((r) => r.courts?.length ?? 1)).toEqual([1, 2])
  })
})
