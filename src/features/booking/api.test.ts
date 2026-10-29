// T11.13: the booking api reads Plotline's current fee (platform_pricing) and carries each booking's stored
// booking_fee and amount_due as numbers. The Supabase client is replaced by a small fake query builder: any chain of
// filters resolves to the table's rows, and .single()/.maybeSingle() to its first row.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: null }
const tables: Record<string, unknown[]> = {}
const rpcs: Record<string, unknown> = {}
/** Every .select() column list, per table, so tests can check what was asked for. */
const selects: [string, string][] = []

function builder(table: string) {
  const rows = () => tables[table] ?? []
  const many = (): Result => ({ data: rows(), error: null })
  const one = (): Result => ({ data: rows()[0] ?? null, error: null })
  const chain: Record<string, unknown> = {}
  chain.select = (columns = '*') => {
    selects.push([table, String(columns)])
    return chain
  }
  for (const name of ['eq', 'neq', 'in', 'is', 'or', 'order', 'limit', 'filter', 'match', 'gte', 'lte', 'gt', 'lt']) {
    chain[name] = () => chain
  }
  chain.single = () => Promise.resolve(one())
  chain.maybeSingle = () => Promise.resolve(one())
  chain.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(many()).then(resolve, reject)
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn((name: string) => Promise.resolve({ data: rpcs[name] ?? null, error: null })),
  },
}))

const { fetchGuestBooking, fetchOwnBooking, fetchPlatformFee } = await import('./api')
const { supabase } = await import('../../lib/supabase')

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key]
  for (const key of Object.keys(rpcs)) delete rpcs[key]
  selects.length = 0
  vi.mocked(supabase.from).mockClear()
})

describe('fetchPlatformFee', () => {
  it("reads the current fee from platform_pricing as a number", async () => {
    tables.platform_pricing = [{ booking_fee: 10 }]
    await expect(fetchPlatformFee()).resolves.toBe(10)
    expect(supabase.from).toHaveBeenCalledWith('platform_pricing')
    expect(selects.find(([table]) => table === 'platform_pricing')?.[1]).toMatch(/\bbooking_fee\b/)
  })

  it('keeps centavos and turns a numeric string into a number', async () => {
    tables.platform_pricing = [{ booking_fee: '10.50' }]
    await expect(fetchPlatformFee()).resolves.toBe(10.5)
  })

  it('reads a fee of 0 as 0', async () => {
    tables.platform_pricing = [{ booking_fee: 0 }]
    await expect(fetchPlatformFee()).resolves.toBe(0)
  })
})

// 7 AM in Manila (11 PM UTC the day before), court price 350, fee 10, amount due 360.
const guestRow = {
  id: 'b1', reference_code: 'CB-7KQ2XD', court_id: 'c1', court_name: 'Pickleball 1', sport: 'pickleball',
  slot_start: '2030-01-06T23:00:00+00:00', slot_end: '2030-01-07T00:00:00+00:00', status: 'pending_payment',
  total_amount: '350.00', booking_fee: '10.00', amount_due: '360.00',
  expires_at: '2030-01-06T15:30:00+00:00', rejection_count: 0, guest_name: 'Gina Guest', guest_email: 'gina@example.com',
  created_at: '2030-01-06T15:00:00+00:00', payments: [], cancelled_at: null, cancel_reason: null, cancelled_by_venue: false,
  parent_reference_code: null, continuations: [], changes: [],
}

describe('booking amounts (T11.13)', () => {
  it('a guest booking carries booking_fee and amount_due as numbers', async () => {
    rpcs.get_guest_booking = [guestRow]
    const booking = await fetchGuestBooking('CB-7KQ2XD', 'tok')
    expect(booking.total_amount).toBe(350)
    expect(booking.booking_fee).toBe(10)
    expect(booking.amount_due).toBe(360)
  })

  it("an owner's booking (read through RLS) carries booking_fee and amount_due as numbers", async () => {
    tables.bookings = [{
      id: 'b1', reference_code: 'CB-7KQ2XD', court_id: 'c1', user_id: 'u1',
      during: '["2030-01-06 23:00:00+00","2030-01-07 00:00:00+00")', status: 'pending_payment',
      total_amount: 350, booking_fee: 10, amount_due: 360,
      expires_at: '2030-01-06T15:30:00+00:00', rejection_count: 0, guest_name: 'Pat Player', guest_email: null,
      created_at: '2030-01-06T15:00:00+00:00', cancelled_at: null, cancel_reason: null, cancelled_by_venue: false,
      parent_booking_id: null, courts: { name: 'Pickleball 1', sport: 'pickleball' }, payments: [],
    }]
    tables.booking_changes = []
    const booking = await fetchOwnBooking('CB-7KQ2XD')
    expect(booking.total_amount).toBe(350)
    expect(booking.booking_fee).toBe(10)
    expect(booking.amount_due).toBe(360)
    // The owner path asks for the stored fee columns (the fake would hand them over either way).
    const own = selects.find(([table, columns]) => table === 'bookings' && /\btotal_amount\b/.test(columns))?.[1] ?? ''
    expect(own).toMatch(/\bbooking_fee\b/)
    expect(own).toMatch(/\bamount_due\b/)
  })
})
