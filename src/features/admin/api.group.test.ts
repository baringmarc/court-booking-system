// T33.4: the admin reads for grouped bookings: booking_group_id on every AdminBooking, toAdminBooking (the list's row
// mapping, now exported), fetchAdminGroup (every court of a checkout by group id, plus its lead) and adminKeys.group.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'

type Call = { table: string; select: string; eqs: [string, unknown][]; orders: string[]; single: boolean }
const h = vi.hoisted(() => ({
  calls: [] as { table: string; select: string; eqs: [string, unknown][]; orders: string[]; single: boolean }[],
  bookingRows: [] as unknown[],
  groupRow: null as { lead_booking_id: string | null } | null,
}))

vi.mock('../../lib/supabase', () => {
  const builder = (table: string) => {
    const call: Call = { table, select: '', eqs: [], orders: [], single: false }
    h.calls.push(call)
    const chain: Record<string, unknown> = {}
    chain.select = (columns: string) => { call.select = columns; return chain }
    chain.eq = (column: string, value: unknown) => { call.eqs.push([column, value]); return chain }
    chain.order = (column: string) => { call.orders.push(column); return chain }
    for (const m of ['limit', 'in', 'or', 'overlaps', 'not']) chain[m] = () => chain
    chain.maybeSingle = () => { call.single = true; return Promise.resolve({ data: table === 'booking_groups' ? h.groupRow : null, error: null }) }
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: table === 'bookings' ? h.bookingRows : [], error: null }).then(resolve)
    return chain
  }
  return { supabase: { from: builder, rpc: () => Promise.resolve({ data: null, error: null }) } }
})

import { adminKeys, fetchAdminBookings, fetchAdminGroup, toAdminBooking } from './api'
import { DEFAULT_FILTERS } from './bookingFilters'

const VENUE_ID = 'b0000000-0000-4000-8000-0000000000b1'
type Row = Parameters<typeof toAdminBooking>[0]

/** A row as the SELECT returns it. */
const row = (id: string, ref: string, courtId: string, during: string, overrides: Record<string, unknown> = {}) => ({
  id, reference_code: ref, court_id: courtId, during, status: 'confirmed', source: 'online', total_amount: '350.00', booking_fee: '10.00',
  amount_due: '360.00', expires_at: null, rejection_count: 0, guest_name: 'Gina Guest', guest_email: null, guest_phone: null,
  created_at: '2030-01-06T15:00:00+00:00', cancelled_at: null, cancel_reason: null, cancelled_by_venue: false, parent_booking_id: null,
  booking_group_id: 'g1', courts: { name: `Court ${courtId}`, sport: 'badminton' }, payments: [], refunds: [], owed: [], ...overrides,
}) as unknown as Row

const early = row('b1', 'CB-LEAD01', 'c1', '["2030-01-06 23:00:00+00","2030-01-07 00:00:00+00")')
const late = row('b2', 'CB-PART02', 'c2', '["2030-01-07 15:00:00+00","2030-01-07 17:00:00+00")', { total_amount: '700.00', booking_fee: '0.00', amount_due: '700.00' })

beforeEach(() => {
  h.calls.length = 0
  h.bookingRows = []
  h.groupRow = null
  setCurrentVenue({ id: VENUE_ID, slug: 'bay-courts', status: 'active' })
})

describe('toAdminBooking', () => {
  it('maps a row as the list always did, and carries booking_group_id', () => {
    const booking = toAdminBooking(row('b1', 'CB-LEAD01', 'c1', '["2030-01-06 23:00:00+00","2030-01-07 00:00:00+00")', {
      payments: [
        { id: 'p2', method: 'gcash', amount: '200.00', submitted_at: '2030-01-06T17:00:00+00:00', review_status: 'pending' },
        { id: 'p1', method: 'gcash', amount: '160.00', submitted_at: '2030-01-06T16:00:00+00:00', review_status: 'rejected' },
      ],
      refunds: [{ id: 'r2', amount: '10.00' }, { id: 'r1', amount: '5.50' }],
    }))
    expect(booking).toMatchObject({
      id: 'b1', reference_code: 'CB-LEAD01', court_id: 'c1', court_name: 'Court c1', sport: 'badminton', status: 'confirmed', source: 'online',
      total_amount: 350, booking_fee: 10, amount_due: 360, guest_name: 'Gina Guest', booking_group_id: 'g1', parent_booking_id: null,
    })
    expect(Date.parse(booking.slot_start)).toBe(Date.parse('2030-01-06T23:00:00Z'))
    expect(Date.parse(booking.slot_end)).toBe(Date.parse('2030-01-07T00:00:00Z'))
    // Payments oldest first with numeric amounts; refunds by id with numeric amounts.
    expect(booking.payments.map((p) => [p.id, p.amount])).toEqual([['p1', 160], ['p2', 200]])
    expect(booking.refunds.map((r) => [r.id, r.amount])).toEqual([['r1', 5.5], ['r2', 10]])
  })

  it('has booking_group_id null for a booking alone, and falls back to "Court" without a court row', () => {
    const booking = toAdminBooking(row('b9', 'CB-SOLO09', 'c9', '["2030-01-06 23:00:00+00","2030-01-07 00:00:00+00")', { booking_group_id: null, courts: null }))
    expect(booking.booking_group_id).toBeNull()
    expect(booking.court_name).toBe('Court')
    expect(booking.sport).toBeNull()
  })
})

describe('the group lead on a booking (T33.6)', () => {
  it('embeds booking_groups.lead_booking_id in the list’s SELECT', async () => {
    await fetchAdminBookings({ ...DEFAULT_FILTERS, status: 'all' }, 'Asia/Manila')
    expect(h.calls[0].select).toMatch(/booking_group:booking_groups!bookings_booking_group_fkey\(lead_booking_id\)/)
  })

  it('maps the embedded lead to group_lead_id: the lead’s id for a grouped row, null without a group or a readable group row', () => {
    const during = '["2030-01-06 23:00:00+00","2030-01-07 00:00:00+00")'
    expect(toAdminBooking(row('b2', 'CB-PART02', 'c2', during, { booking_group: { lead_booking_id: 'b1' } })).group_lead_id).toBe('b1')
    expect(toAdminBooking(row('b9', 'CB-SOLO09', 'c9', during, { booking_group_id: null, booking_group: null })).group_lead_id).toBeNull()
    expect(toAdminBooking(row('b3', 'CB-X', 'c3', during, { booking_group: null })).group_lead_id).toBeNull()
    expect(toAdminBooking(row('b4', 'CB-Y', 'c4', during, { booking_group: { lead_booking_id: null } })).group_lead_id).toBeNull()
  })
})

describe('fetchAdminBookings (T33.4)', () => {
  it('selects booking_group_id and returns it on each booking', async () => {
    h.bookingRows = [early, row('b9', 'CB-SOLO09', 'c9', '["2030-01-06 23:00:00+00","2030-01-07 00:00:00+00")', { booking_group_id: null })]
    const { bookings } = await fetchAdminBookings({ ...DEFAULT_FILTERS, status: 'all' }, 'Asia/Manila')
    expect(h.calls[0].select).toContain('booking_group_id')
    expect(bookings.map((b) => b.booking_group_id)).toEqual(['g1', null])
  })
})

describe('fetchAdminGroup', () => {
  it('reads the group’s bookings with the list’s SELECT, by group id and venue, ordered by start then court id', async () => {
    h.bookingRows = [late, early]
    await fetchAdminBookings({ ...DEFAULT_FILTERS, status: 'all' }, 'Asia/Manila')
    const listSelect = h.calls[0].select
    h.calls.length = 0
    h.groupRow = { lead_booking_id: 'b1' }
    const group = await fetchAdminGroup('g1')

    const bookings = h.calls.find((c) => c.table === 'bookings')!
    expect(bookings.select).toBe(listSelect)
    expect(bookings.eqs).toContainEqual(['booking_group_id', 'g1'])
    expect(bookings.eqs).toContainEqual(['venue_id', VENUE_ID])
    // Ordered by start then court id: on the server, or by the function itself (the mock returns the rows as given).
    const serverOrdered = bookings.orders.indexOf('during') >= 0 && bookings.orders.indexOf('court_id') > bookings.orders.indexOf('during')
    const clientOrdered = group.bookings.map((b) => b.id).join() === 'b1,b2'
    expect(serverOrdered || clientOrdered).toBe(true)

    const groups = h.calls.find((c) => c.table === 'booking_groups')!
    expect(groups.select).toBe('lead_booking_id')
    expect(groups.eqs).toContainEqual(['id', 'g1'])
    expect(groups.single).toBe(true)
  })

  it('returns the id, the lead’s reference code and every court as an AdminBooking', async () => {
    h.bookingRows = [early, late]
    h.groupRow = { lead_booking_id: 'b2' }
    const group = await fetchAdminGroup('g1')
    expect(group.id).toBe('g1')
    expect(group.lead_reference_code).toBe('CB-PART02')
    expect(group.bookings.map((b) => b.reference_code)).toEqual(['CB-LEAD01', 'CB-PART02'])
    expect(group.bookings[1]).toMatchObject({ amount_due: 700, court_name: 'Court c2', booking_group_id: 'g1' })
  })

  it('takes the first court as the lead when booking_groups has no row for it', async () => {
    h.bookingRows = [early, late]
    h.groupRow = null
    expect((await fetchAdminGroup('g1')).lead_reference_code).toBe('CB-LEAD01')
    h.groupRow = { lead_booking_id: null }
    expect((await fetchAdminGroup('g1')).lead_reference_code).toBe('CB-LEAD01')
  })
})

describe('adminKeys.group', () => {
  it('is [venue id, "admin-bookings", "group", id], under allBookings so that invalidating the bookings refreshes it', () => {
    expect(adminKeys.group('g1')).toEqual([VENUE_ID, 'admin-bookings', 'group', 'g1'])
    expect(adminKeys.group('g1').slice(0, adminKeys.allBookings().length)).toEqual([...adminKeys.allBookings()])
  })
})
