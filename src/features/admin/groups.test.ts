// T33.4 (reworked in T33.6): the pure helpers behind the admin's grouped bookings (SPEC §7 `/admin/bookings`, "Bookings in a group").
import { describe, expect, it } from 'vitest'
import type { AdminBooking, AdminPayment } from './api'
import { checkoutOnlinePayments, groupPayment, reviewQueueEntries } from './groups'

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

  // T33.6 (SPEC §10 2026-11-25 "Checkout panel"): the entry is the LEAD, not the first booking in list order.
  it('makes one entry per group, whose booking is the lead (group_lead_id), wherever it is in the list', () => {
    const [s1, a1, b1, a2, b2, s2] = [
      booking('s1', null), booking('a1', 'g1', { group_lead_id: 'a2' }), booking('b1', 'g2', { group_lead_id: 'b1' }),
      booking('a2', 'g1', { group_lead_id: 'a2' }), booking('b2', 'g2', { group_lead_id: 'b1' }), booking('s2', null),
    ]
    const entries = reviewQueueEntries([s1, a1, b1, a2, b2, s2])
    expect(entries.map((e) => e.booking.id)).toEqual(['s1', 'a2', 'b1', 's2'])
    expect(entries[1].courts.map((c) => c.id).sort()).toEqual(['a1', 'a2'])
    expect(entries[2].courts.map((c) => c.id).sort()).toEqual(['b1', 'b2'])
    expect(entries[0].courts).toEqual([s1])
  })

  it('takes the earliest-starting listed court when the lead is not listed, then the smaller court id', () => {
    const lateStart = { slot_start: '2030-01-07T09:00:00.000Z', slot_end: '2030-01-07T10:00:00.000Z' }
    const [late, early, tieB, tieA] = [
      booking('late', 'g1', { ...lateStart, group_lead_id: 'gone' }),
      booking('early', 'g1', { group_lead_id: 'gone', court_id: 'c-z' }),
      booking('tb', 'g2', { court_id: 'c-b' }),
      booking('ta', 'g2', { court_id: 'c-a' }),
    ]
    const entries = reviewQueueEntries([late, early, tieB, tieA])
    expect(entries.map((e) => e.booking.id)).toEqual(['early', 'ta'])
  })

  it('takes the earliest-starting court when group_lead_id is absent or null', () => {
    const [late, early, nullLead] = [
      booking('late', 'g1', { slot_start: '2030-01-07T09:00:00.000Z', slot_end: '2030-01-07T10:00:00.000Z' }),
      booking('early', 'g1'),
      booking('n1', 'g2', { group_lead_id: null }),
    ]
    expect(reviewQueueEntries([late, early, nullLead]).map((e) => e.booking.id)).toEqual(['early', 'n1'])
  })

  it('keeps the entry where the group’s first listed booking was, and sorts courts by start then court id', () => {
    const [late, solo, early, tie] = [
      booking('late', 'g1', { group_lead_id: 'late', slot_start: '2030-01-07T09:00:00.000Z', slot_end: '2030-01-07T10:00:00.000Z' }),
      booking('solo', null),
      booking('early', 'g1', { court_id: 'c-b' }),
      booking('tie', 'g1', { court_id: 'c-a' }),
    ]
    const entries = reviewQueueEntries([late, solo, early, tie])
    expect(entries.map((e) => e.booking.id)).toEqual(['late', 'solo'])
    // early and tie start together: court id c-a before c-b; late starts later.
    expect(entries[0].courts.map((c) => c.id)).toEqual(['tie', 'early', 'late'])
  })
})

describe('groupPosition', () => {
  it('is removed: no UI says "Booking X of N" any more (T33.6)', async () => {
    const mod = await import('./groups')
    expect('groupPosition' in mod).toBe(false)
  })
})

describe('checkoutOnlinePayments', () => {
  const online = (id: string, amount: number, overrides: Partial<AdminPayment> = {}) =>
    payment(id, { method: 'paymongo', amount, provider_payment_id: 'pay_1', provider_source: 'gcash', review_status: 'approved', ...overrides })

  it('is empty when no court has a PayMongo payment (proofs are not online payments)', () => {
    expect(checkoutOnlinePayments([booking('a1', 'g1', { payments: [payment('p1')] }), booking('a2', 'g1')])).toEqual([])
    expect(checkoutOnlinePayments([])).toEqual([])
  })

  it('lists one PayMongo payment once: the first row’s fields, the amount summed across the courts', () => {
    const first = online('r1', 360, { reviewed_at: '2030-01-07T02:20:00.000Z' })
    const second = online('r2', 700, { reviewed_at: '2030-01-07T02:21:00.000Z' })
    const result = checkoutOnlinePayments([booking('a1', 'g1', { payments: [first] }), booking('a2', 'g1', { payments: [second] })])
    expect(result).toEqual([{ ...first, amount: 1060 }])
  })

  it('keeps separate PayMongo payments apart, ordered by submitted_at, and ignores other methods', () => {
    const later = online('l1', 100, { provider_payment_id: 'pay_late', submitted_at: '2030-01-07T05:00:00.000Z' })
    const earlier = online('e1', 50, { provider_payment_id: 'pay_early', submitted_at: '2030-01-07T01:00:00.000Z' })
    const earlier2 = online('e2', 25, { provider_payment_id: 'pay_early', submitted_at: '2030-01-07T01:00:00.000Z' })
    const result = checkoutOnlinePayments([
      booking('a1', 'g1', { payments: [later, payment('gc', { submitted_at: '2030-01-07T00:00:00.000Z' })] }),
      booking('a2', 'g1', { payments: [earlier, earlier2] }),
    ])
    expect(result.map((p) => [p.provider_payment_id, p.amount])).toEqual([['pay_early', 75], ['pay_late', 100]])
  })

  it('adds centavos without float drift', () => {
    const result = checkoutOnlinePayments([
      booking('a1', 'g1', { payments: [online('r1', 0.1)] }),
      booking('a2', 'g1', { payments: [online('r2', 0.2)] }),
    ])
    expect(result[0].amount).toBeCloseTo(0.3, 10)
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
