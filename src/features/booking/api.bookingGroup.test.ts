// T33.4: both booking reads carry the booking group. A guest gets it from get_guest_booking's `booking_group` (jsonb,
// SPEC §6: numbers may arrive as strings, court_id is null, refunds go through parsePlayerRefund). An owner or staff
// reads the group's bookings through RLS, each court's refund from get_own_booking_refund, and the lead from
// booking_groups when readable (null for a player: RLS shows them none), else the earliest-starting court.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: null | { message: string } }
type Call = { table: string; select: string; eqs: [string, unknown][] }
const calls: Call[] = []
let groupRows: unknown[] = []
let ownRow: unknown = null
let leadRow: { lead_booking_id: string | null } | null = null
const rpcs: Record<string, Result> = {}
const rpcCalls: [string, Record<string, unknown>][] = []

/** What a finished query returns: by table, and for bookings by which filter it carries. */
function resultFor(call: Call): { many: unknown[]; one: unknown } {
  const has = (column: string) => call.eqs.some(([c]) => c === column)
  if (call.table === 'bookings' && has('booking_group_id')) return { many: groupRows, one: groupRows[0] ?? null }
  if (call.table === 'bookings' && has('reference_code')) return { many: [ownRow], one: ownRow }
  if (call.table === 'booking_groups') return { many: leadRow ? [leadRow] : [], one: leadRow }
  return { many: [], one: null }
}

function builder(table: string) {
  const call: Call = { table, select: '', eqs: [] }
  calls.push(call)
  const chain: Record<string, unknown> = {}
  chain.select = (columns: string) => { call.select = columns; return chain }
  chain.eq = (column: string, value: unknown) => { call.eqs.push([column, value]); return chain }
  for (const name of ['neq', 'in', 'is', 'or', 'order', 'limit']) chain[name] = () => chain
  chain.single = () => Promise.resolve({ data: resultFor(call).one, error: null })
  chain.maybeSingle = () => Promise.resolve({ data: resultFor(call).one, error: null })
  chain.then = (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data: resultFor(call).many, error: null }).then(resolve, reject)
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args])
      return Promise.resolve(rpcs[`${name}:${args.p_booking_id ?? ''}`] ?? rpcs[name] ?? { data: null, error: null })
    }),
  },
}))

const { fetchGuestBooking, fetchOwnBooking } = await import('./api')

beforeEach(() => {
  calls.length = 0
  rpcCalls.length = 0
  groupRows = []
  ownRow = null
  leadRow = null
  for (const key of Object.keys(rpcs)) delete rpcs[key]
})

const ms = (iso: string) => Date.parse(iso)

// ---- the guest path ----

const guestRow = {
  id: 'b1', reference_code: 'CB-LEAD01', court_id: 'c1', court_name: 'Badminton 1', sport: 'badminton',
  slot_start: '2030-01-06T23:00:00+00:00', slot_end: '2030-01-07T00:00:00+00:00', status: 'confirmed',
  total_amount: '350.00', booking_fee: '10.00', amount_due: '360.00', waiver_text: null, waiver_accepted_at: null,
  expires_at: null, rejection_count: 0, guest_name: 'Gina Guest', guest_email: 'gina@example.com',
  created_at: '2030-01-06T15:00:00+00:00', payments: [], cancelled_at: null, cancel_reason: null, cancelled_by_venue: false,
  parent_reference_code: null, continuations: [], changes: [], refund: null as unknown, booking_group: null as unknown,
}
const bookingGroup = {
  id: 'g1', lead_reference_code: 'CB-LEAD01', total_amount: '1050.00', booking_fee: '10.00', amount_due: '1060.00',
  bookings: [
    { reference_code: 'CB-LEAD01', court_name: 'Badminton 1', sport: 'badminton', slot_start: '2030-01-06T23:00:00+00:00', slot_end: '2030-01-07T00:00:00+00:00',
      status: 'confirmed', total_amount: '350.00', booking_fee: '10.00', amount_due: '360.00', refund: null },
    { reference_code: 'CB-PART02', court_name: 'Tennis Court', sport: 'tennis', slot_start: '2030-01-07T15:00:00+00:00', slot_end: '2030-01-07T17:00:00+00:00',
      status: 'cancelled', total_amount: '700.00', booking_fee: '0.00', amount_due: '700.00',
      refund: { status: 'owed', amount: '700.00', method: null, settled_on: null, reason: null, note: 'STAFF ONLY' } },
  ],
}

describe('guest path: booking_group (T33.4)', () => {
  it('parses the group: numbers as numbers, court_id null, the refund through parsePlayerRefund', async () => {
    rpcs.get_guest_booking = { data: [{ ...guestRow, booking_group: bookingGroup }], error: null }
    const booking = await fetchGuestBooking('CB-LEAD01', 'tok')
    const group = booking.group!
    expect(group.id).toBe('g1')
    expect(group.lead_reference_code).toBe('CB-LEAD01')
    expect([group.total_amount, group.booking_fee, group.amount_due]).toEqual([1050, 10, 1060])
    expect(group.bookings).toHaveLength(2)
    const [lead, part] = group.bookings
    expect(lead).toMatchObject({
      reference_code: 'CB-LEAD01', court_id: null, court_name: 'Badminton 1', sport: 'badminton', status: 'confirmed',
      total_amount: 350, booking_fee: 10, amount_due: 360, refund: null,
    })
    expect([ms(lead.slot_start), ms(lead.slot_end)]).toEqual([ms('2030-01-06T23:00:00Z'), ms('2030-01-07T00:00:00Z')])
    expect(part).toMatchObject({
      reference_code: 'CB-PART02', court_id: null, court_name: 'Tennis Court', sport: 'tennis', status: 'cancelled',
      total_amount: 700, booking_fee: 0, amount_due: 700,
      refund: { status: 'owed', amount: 700, method: null, settled_on: null, reason: null },
    })
    // Never the staff note, even if it came along.
    expect(JSON.stringify(booking)).not.toContain('STAFF ONLY')
  })

  it('keeps the opened booking’s own fields as they were', async () => {
    rpcs.get_guest_booking = { data: [{ ...guestRow, booking_group: bookingGroup }], error: null }
    const booking = await fetchGuestBooking('CB-LEAD01', 'tok')
    expect(booking).toMatchObject({ reference_code: 'CB-LEAD01', court_id: 'c1', total_amount: 350, booking_fee: 10, amount_due: 360 })
  })

  it('has group null when the booking is in no group', async () => {
    rpcs.get_guest_booking = { data: [{ ...guestRow, booking_group: null }], error: null }
    expect((await fetchGuestBooking('CB-LEAD01', 'tok')).group).toBeNull()
  })

  it('makes no extra call for a group', async () => {
    rpcs.get_guest_booking = { data: [{ ...guestRow, booking_group: bookingGroup }], error: null }
    await fetchGuestBooking('CB-LEAD01', 'tok')
    expect(rpcCalls.map(([name]) => name)).toEqual(['get_guest_booking'])
    expect(calls).toEqual([])
  })
})

// ---- the owner and staff path ----

// What the bookings select returns for each row (the group read uses the same column names).
const ownBookingRow = (id: string, reference: string, courtId: string, courtName: string, sport: string, during: string, overrides: Record<string, unknown> = {}) => ({
  id, reference_code: reference, court_id: courtId, user_id: 'u1', during, status: 'confirmed',
  total_amount: 350, booking_fee: 0, amount_due: 350, waiver_text: null, waiver_accepted_at: null,
  expires_at: null, rejection_count: 0, guest_name: 'Pat Player', guest_email: null,
  created_at: '2030-01-06T15:00:00+00:00', cancelled_at: null, cancel_reason: null, cancelled_by_venue: false,
  parent_booking_id: null, booking_group_id: 'g1', courts: { name: courtName, sport }, payments: [], ...overrides,
})
const early = ownBookingRow('b1', 'CB-LEAD01', 'c1', 'Badminton 1', 'badminton', '["2030-01-06 23:00:00+00","2030-01-07 00:00:00+00")',
  { total_amount: 350, booking_fee: 10, amount_due: 360 })
const late = ownBookingRow('b2', 'CB-PART02', 'c2', 'Tennis Court', 'tennis', '["2030-01-07 15:00:00+00","2030-01-07 17:00:00+00")',
  { status: 'cancelled', total_amount: 700, booking_fee: 0, amount_due: 700, cancelled_by_venue: true })

describe('owner path: the group read through RLS (T33.4)', () => {
  beforeEach(() => {
    ownRow = early
    // Returned out of order on purpose: the group lists courts by start.
    groupRows = [late, early]
    rpcs['get_own_booking_refund:b1'] = { data: null, error: null }
    rpcs['get_own_booking_refund:b2'] = { data: { status: 'owed', amount: '700.00', method: null, settled_on: null, reason: null, note: 'STAFF ONLY' }, error: null }
  })

  it('selects booking_group_id with the booking, and reads the group’s bookings by that id', async () => {
    leadRow = { lead_booking_id: 'b1' }
    await fetchOwnBooking('CB-LEAD01')
    expect(calls[0].table).toBe('bookings')
    expect(calls[0].select).toContain('booking_group_id')
    const read = calls.find((c) => c.table === 'bookings' && c.eqs.some(([col]) => col === 'booking_group_id'))
    expect(read?.eqs).toContainEqual(['booking_group_id', 'g1'])
    expect(read?.select).toContain('courts(name, sport)')
    const lead = calls.find((c) => c.table === 'booking_groups')
    expect(lead?.select).toBe('lead_booking_id')
    expect(lead?.eqs).toContainEqual(['id', 'g1'])
  })

  it('builds the group: courts by start, sums over the courts, court_id set, the lead from booking_groups', async () => {
    leadRow = { lead_booking_id: 'b2' }
    const group = (await fetchOwnBooking('CB-LEAD01')).group!
    expect(group.id).toBe('g1')
    expect(group.lead_reference_code).toBe('CB-PART02')
    expect([group.total_amount, group.booking_fee, group.amount_due]).toEqual([1050, 10, 1060])
    expect(group.bookings.map((b) => b.reference_code)).toEqual(['CB-LEAD01', 'CB-PART02'])
    expect(group.bookings[0]).toMatchObject({
      court_id: 'c1', court_name: 'Badminton 1', sport: 'badminton', status: 'confirmed', total_amount: 350, booking_fee: 10, amount_due: 360, refund: null,
    })
    expect([ms(group.bookings[0].slot_start), ms(group.bookings[0].slot_end)]).toEqual([ms('2030-01-06T23:00:00Z'), ms('2030-01-07T00:00:00Z')])
    expect(group.bookings[1]).toMatchObject({
      court_id: 'c2', court_name: 'Tennis Court', sport: 'tennis', status: 'cancelled', total_amount: 700, booking_fee: 0, amount_due: 700,
      refund: { status: 'owed', amount: 700, method: null, settled_on: null, reason: null },
    })
    expect(JSON.stringify(group)).not.toContain('STAFF ONLY')
  })

  it('reads each court’s refund with get_own_booking_refund', async () => {
    await fetchOwnBooking('CB-LEAD01')
    expect(rpcCalls).toContainEqual(['get_own_booking_refund', { p_booking_id: 'b1' }])
    expect(rpcCalls).toContainEqual(['get_own_booking_refund', { p_booking_id: 'b2' }])
  })

  it('the opened booking keeps its own refund', async () => {
    const opened = await fetchOwnBooking('CB-LEAD01')
    expect(opened.refund).toBeNull()
    ownRow = late
    const other = await fetchOwnBooking('CB-PART02')
    expect(other.refund).toEqual({ status: 'owed', amount: 700, method: null, settled_on: null, reason: null })
  })

  it('takes the lead from booking_groups when the caller can read it, even when it is not the earliest court', async () => {
    leadRow = { lead_booking_id: 'b2' }
    expect((await fetchOwnBooking('CB-LEAD01')).group?.lead_reference_code).toBe('CB-PART02')
  })

  it('falls back to the earliest-starting court when booking_groups shows nothing (a player)', async () => {
    leadRow = null
    expect((await fetchOwnBooking('CB-LEAD01')).group?.lead_reference_code).toBe('CB-LEAD01')
  })

  it('breaks a tie on start by the smaller court id', async () => {
    const sameStart = ownBookingRow('b3', 'CB-TIE003', 'c0', 'Badminton 2', 'badminton', '["2030-01-06 23:00:00+00","2030-01-07 00:00:00+00")')
    groupRows = [early, sameStart]
    leadRow = null
    expect((await fetchOwnBooking('CB-LEAD01')).group?.lead_reference_code).toBe('CB-TIE003')
  })
})

describe('owner path: a single booking makes no group calls (T33.4)', () => {
  it('reads no group, no booking_groups row and no extra refund', async () => {
    ownRow = ownBookingRow('b9', 'CB-SOLO09', 'c9', 'Badminton 1', 'badminton', '["2030-01-06 23:00:00+00","2030-01-07 00:00:00+00")', { booking_group_id: null })
    const booking = await fetchOwnBooking('CB-SOLO09')
    expect(booking.group ?? null).toBeNull()
    expect(calls.some((c) => c.table === 'booking_groups')).toBe(false)
    expect(calls.some((c) => c.eqs.some(([col]) => col === 'booking_group_id'))).toBe(false)
    expect(rpcCalls).toEqual([['get_own_booking_refund', { p_booking_id: 'b9' }]])
  })
})
