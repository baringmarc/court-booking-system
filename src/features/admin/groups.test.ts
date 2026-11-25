// T33.4: the pure helpers behind the admin's grouped bookings (SPEC §7 `/admin/bookings`, "Bookings in a group").
import { describe, expect, it } from 'vitest'
import type { AdminBooking, AdminGroup, AdminPayment } from './api'
import { groupPayment, groupPosition, reviewQueueEntries } from './groups'

const payment = (id: string, overrides: Partial<AdminPayment> = {}): AdminPayment => ({
  id, method: 'gcash', amount: 360, reference_number: null, storage_path: null, submitted_at: '2030-01-07T02:00:00.000Z',
  review_status: 'pending', review_note: null, reviewed_at: null, reviewed_by: null, provider_payment_id: null, provider_source: null,
  ...overrides,
})
const booking = (id: string, group: string | null | undefined, overrides: Partial<AdminBooking> = {}): AdminBooking => ({
  id, reference_code: `CB-${id}`, court_id: `c-${id}`, court_name: `Court ${id}`, sport: 'badminton',
  slot_start: '2030-01-06T23:00:00.000Z', slot_end: '2030-01-07T00:00:00.000Z', status: 'payment_submitted', source: 'online',
  total_amount: 350, booking_fee: 0, amount_due: 350, expires_at: null, rejection_count: 0, guest_name: 'Gina Guest',
  guest_email: null, guest_phone: null, created_at: '2030-01-06T15:00:00.000Z', payments: [], refunds: [],
  cancelled_at: null, cancel_reason: null, cancelled_by_venue: false, parent_booking_id: null, booking_group_id: group, ...overrides,
})

describe('reviewQueueEntries', () => {
  it('is empty for an empty list', () => {
    expect(reviewQueueEntries([])).toEqual([])
  })

  it('makes a booking without a group its own entry, with itself as its only court', () => {
    const solo = booking('s1', null)
    const unset = booking('s2', undefined)
    expect(reviewQueueEntries([solo, unset])).toEqual([
      { booking: solo, courts: [solo] },
      { booking: unset, courts: [unset] },
    ])
  })

  it('makes one entry per group: the first of its bookings in list order, with all of the group’s bookings in list order', () => {
    const [s1, a1, b1, a2, b2, s2] = [booking('s1', null), booking('a1', 'g1'), booking('b1', 'g2'), booking('a2', 'g1'), booking('b2', 'g2'), booking('s2', null)]
    const entries = reviewQueueEntries([s1, a1, b1, a2, b2, s2])
    expect(entries.map((e) => e.booking.id)).toEqual(['s1', 'a1', 'b1', 's2'])
    expect(entries[1].courts).toEqual([a1, a2])
    expect(entries[2].courts).toEqual([b1, b2])
    expect(entries[0].courts).toEqual([s1])
  })

  it('keeps list order: the group sits where its first booking is, and the later bookings are dropped', () => {
    const [late, solo, early] = [booking('late', 'g1'), booking('solo', null), booking('early', 'g1')]
    const entries = reviewQueueEntries([late, solo, early])
    expect(entries.map((e) => e.booking.id)).toEqual(['late', 'solo'])
    expect(entries[0].courts.map((c) => c.id)).toEqual(['late', 'early'])
  })
})

describe('groupPosition', () => {
  const group: AdminGroup = { id: 'g1', lead_reference_code: 'CB-a1', bookings: [booking('a1', 'g1'), booking('a2', 'g1'), booking('a3', 'g1')] }

  it('is 1-based, by the group’s bookings order, with the count', () => {
    expect(groupPosition(group, 'a1')).toEqual({ index: 1, count: 3 })
    expect(groupPosition(group, 'a2')).toEqual({ index: 2, count: 3 })
    expect(groupPosition(group, 'a3')).toEqual({ index: 3, count: 3 })
  })
})

describe('groupPayment', () => {
  it('is the pending payment that has the file, with the sum of every court’s pending payments', () => {
    const withFile = payment('p1', { amount: 360, storage_path: 'a1/proof.png' })
    const noFile = payment('p2', { amount: 700 })
    const courts = [booking('a1', 'g1', { payments: [withFile] }), booking('a2', 'g1', { payments: [noFile] })]
    expect(groupPayment(courts)).toEqual({ payment: withFile, amount: 1060 })
    // Whichever court comes first.
    expect(groupPayment([...courts].reverse())).toEqual({ payment: withFile, amount: 1060 })
  })

  it('falls back to the first pending payment when none has a file', () => {
    const p1 = payment('p1', { amount: 360 })
    const p2 = payment('p2', { amount: 700 })
    expect(groupPayment([booking('a1', 'g1', { payments: [p1] }), booking('a2', 'g1', { payments: [p2] })])).toEqual({ payment: p1, amount: 1060 })
  })

  it('counts only pending payments: approved and rejected ones are history', () => {
    const pending = payment('p1', { amount: 360, storage_path: 'a1/new.png' })
    const courts = [
      booking('a1', 'g1', { payments: [payment('old', { amount: 360, review_status: 'rejected', storage_path: 'a1/old.png' }), pending] }),
      booking('a2', 'g1', { payments: [payment('done', { amount: 700, review_status: 'approved' })] }),
    ]
    expect(groupPayment(courts)).toEqual({ payment: pending, amount: 360 })
  })

  it('has no payment and 0 when nothing is pending', () => {
    expect(groupPayment([booking('a1', 'g1'), booking('a2', 'g1')])).toEqual({ payment: null, amount: 0 })
    expect(groupPayment([])).toEqual({ payment: null, amount: 0 })
  })

  it('adds centavos without float drift', () => {
    const courts = [
      booking('a1', 'g1', { payments: [payment('p1', { amount: 0.1, storage_path: 'a1/p.png' })] }),
      booking('a2', 'g1', { payments: [payment('p2', { amount: 0.2 })] }),
    ]
    expect(groupPayment(courts).amount).toBeCloseTo(0.3, 10)
  })
})
