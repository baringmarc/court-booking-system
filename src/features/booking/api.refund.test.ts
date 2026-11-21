// T30.6: both booking reads carry the player-safe refund: get_guest_booking returns it as `refund`, and an owner (read
// through RLS) gets it from get_own_booking_refund. The staff note never reaches the BookingDetail.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: null | { message: string } }
const tables: Record<string, unknown[]> = {}
const rpcs: Record<string, Result> = {}
const rpcCalls: [string, Record<string, unknown>][] = []

function builder(table: string) {
  const rows = () => tables[table] ?? []
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  for (const name of ['eq', 'neq', 'in', 'is', 'or', 'order', 'limit']) chain[name] = () => chain
  chain.single = () => Promise.resolve({ data: rows()[0] ?? null, error: null })
  chain.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null })
  chain.then = (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject)
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args])
      return Promise.resolve(rpcs[name] ?? { data: null, error: null })
    }),
  },
}))

const { fetchGuestBooking, fetchOwnBooking } = await import('./api')

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key]
  for (const key of Object.keys(rpcs)) delete rpcs[key]
  rpcCalls.length = 0
})

const guestRow = {
  id: 'b1', reference_code: 'CB-7KQ2XD', court_id: 'c1', court_name: 'Pickleball 1', sport: 'pickleball',
  slot_start: '2030-01-06T23:00:00+00:00', slot_end: '2030-01-07T00:00:00+00:00', status: 'cancelled',
  total_amount: '350.00', booking_fee: '0.00', amount_due: '350.00', waiver_text: null, waiver_accepted_at: null,
  expires_at: null, rejection_count: 0, guest_name: 'Gina Guest', guest_email: 'gina@example.com',
  created_at: '2030-01-06T15:00:00+00:00', payments: [], cancelled_at: '2030-01-06T16:00:00+00:00', cancel_reason: 'Rain', cancelled_by_venue: true,
  parent_reference_code: null, continuations: [], changes: [], refund: null as unknown,
}
const ownRow = {
  id: 'b1', reference_code: 'CB-7KQ2XD', court_id: 'c1', user_id: 'u1',
  during: '["2030-01-06 23:00:00+00","2030-01-07 00:00:00+00")', status: 'cancelled',
  total_amount: 350, booking_fee: 0, amount_due: 350, waiver_text: null, waiver_accepted_at: null,
  expires_at: null, rejection_count: 0, guest_name: 'Pat Player', guest_email: null,
  created_at: '2030-01-06T15:00:00+00:00', cancelled_at: '2030-01-06T16:00:00+00:00', cancel_reason: 'Rain', cancelled_by_venue: true,
  parent_booking_id: null, courts: { name: 'Pickleball 1', sport: 'pickleball' }, payments: [],
}
const settled = { status: 'settled', amount: '350.00', method: 'gcash', settled_on: '2030-01-07', reason: null }

describe('guest path refund (T30.6)', () => {
  it('parses get_guest_booking.refund, the amount as a number', async () => {
    rpcs.get_guest_booking = { data: [{ ...guestRow, refund: settled }], error: null }
    const booking = await fetchGuestBooking('CB-7KQ2XD', 'tok')
    expect(booking.refund).toEqual({ status: 'settled', amount: 350, method: 'gcash', settled_on: '2030-01-07', reason: null })
  })

  it('is null when the booking has no refund', async () => {
    rpcs.get_guest_booking = { data: [{ ...guestRow, refund: null }], error: null }
    expect((await fetchGuestBooking('CB-7KQ2XD', 'tok')).refund).toBeNull()
  })

  it('drops a staff note or recorder that came along', async () => {
    rpcs.get_guest_booking = { data: [{ ...guestRow, refund: { ...settled, note: 'STAFF ONLY', recorded_by: 'admin-1' } }], error: null }
    const booking = await fetchGuestBooking('CB-7KQ2XD', 'tok')
    expect(JSON.stringify(booking)).not.toMatch(/STAFF ONLY|admin-1/)
  })

  it('does not call get_own_booking_refund', async () => {
    rpcs.get_guest_booking = { data: [guestRow], error: null }
    await fetchGuestBooking('CB-7KQ2XD', 'tok')
    expect(rpcCalls.map(([name]) => name)).toEqual(['get_guest_booking'])
  })
})

describe('owner path refund (T30.6)', () => {
  beforeEach(() => {
    tables.bookings = [ownRow]
    tables.booking_changes = []
  })

  it("reads the refund with get_own_booking_refund for the booking's id and parses it", async () => {
    rpcs.get_own_booking_refund = { data: { status: 'owed', amount: 350, method: null, settled_on: null, reason: null }, error: null }
    const booking = await fetchOwnBooking('CB-7KQ2XD')
    expect(rpcCalls).toContainEqual(['get_own_booking_refund', { p_booking_id: 'b1' }])
    expect(booking.refund).toEqual({ status: 'owed', amount: 350, method: null, settled_on: null, reason: null })
  })

  it('is null when the function returns null', async () => {
    rpcs.get_own_booking_refund = { data: null, error: null }
    expect((await fetchOwnBooking('CB-7KQ2XD')).refund).toBeNull()
  })

  it('parses a not-refunded refund with its reason, and drops the staff note', async () => {
    rpcs.get_own_booking_refund = { data: { status: 'not_refunded', amount: '350.00', method: null, settled_on: null, reason: 'Court was flooded', note: 'STAFF ONLY' }, error: null }
    const booking = await fetchOwnBooking('CB-7KQ2XD')
    expect(booking.refund).toEqual({ status: 'not_refunded', amount: 350, method: null, settled_on: null, reason: 'Court was flooded' })
    expect(JSON.stringify(booking)).not.toContain('STAFF ONLY')
  })

  it('still returns the booking itself', async () => {
    const booking = await fetchOwnBooking('CB-7KQ2XD')
    expect(booking.reference_code).toBe('CB-7KQ2XD')
    expect(booking.user_id).toBe('u1')
  })
})
