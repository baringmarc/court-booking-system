// T11.20: createBooking sends p_waiver_accepted; booking details carry waiver_text and waiver_accepted_at.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: null }
const tables: Record<string, unknown[]> = {}
const rpcs: Record<string, unknown> = {}
const selects: [string, string][] = []
const rpcCalls: [string, Record<string, unknown>][] = []

function builder(table: string) {
  const rows = () => tables[table] ?? []
  const chain: Record<string, unknown> = {}
  chain.select = (columns = '*') => {
    selects.push([table, String(columns)])
    return chain
  }
  for (const name of ['eq', 'neq', 'in', 'is', 'or', 'order', 'limit', 'filter', 'match', 'gte', 'lte', 'gt', 'lt']) chain[name] = () => chain
  chain.single = () => Promise.resolve<Result>({ data: rows()[0] ?? null, error: null })
  chain.maybeSingle = chain.single
  chain.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve<Result>({ data: rows(), error: null }).then(resolve, reject)
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args])
      return Promise.resolve({ data: rpcs[name] ?? null, error: null })
    }),
  },
}))

const { createBooking, fetchGuestBooking, fetchOwnBooking } = await import('./api')

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key]
  for (const key of Object.keys(rpcs)) delete rpcs[key]
  selects.length = 0
  rpcCalls.length = 0
})

const contact = { name: 'Gina', email: 'g@example.com', phone: '' }

describe('createBooking waiver', () => {
  it('sends p_waiver_accepted true', async () => {
    rpcs.create_booking = [{ id: 'b1', reference_code: 'CB-AAAAAA', guest_token: null }]
    await createBooking({ courtId: 'c1', start: '2030-01-06T23:00:00.000Z', slots: 1, contact, waiverAccepted: true })
    expect(rpcCalls[0][0]).toBe('create_booking')
    expect(rpcCalls[0][1]).toMatchObject({ p_waiver_accepted: true })
  })

  it('sends p_waiver_accepted false', async () => {
    rpcs.create_booking = [{ id: 'b1', reference_code: 'CB-AAAAAA', guest_token: null }]
    await createBooking({ courtId: 'c1', start: '2030-01-06T23:00:00.000Z', slots: 1, contact, waiverAccepted: false })
    expect(rpcCalls[0][1]).toMatchObject({ p_waiver_accepted: false })
  })
})

const base = {
  id: 'b1', reference_code: 'CB-7KQ2XD', court_id: 'c1', court_name: 'Pickleball 1', sport: 'pickleball',
  slot_start: '2030-01-06T23:00:00+00:00', slot_end: '2030-01-07T00:00:00+00:00', status: 'confirmed',
  total_amount: '350.00', booking_fee: '10.00', amount_due: '360.00', expires_at: null, rejection_count: 0,
  guest_name: 'Gina', guest_email: 'g@example.com', created_at: '2030-01-06T15:00:00+00:00', payments: [],
  cancelled_at: null, cancel_reason: null, cancelled_by_venue: false, parent_reference_code: null, continuations: [], changes: [],
}

describe('booking details waiver', () => {
  it('a guest booking carries waiver_text and waiver_accepted_at', async () => {
    rpcs.get_guest_booking = [{ ...base, waiver_text: 'Own risk.', waiver_accepted_at: '2030-01-06T15:00:00+00:00' }]
    const b = await fetchGuestBooking('CB-7KQ2XD', 'tok')
    expect(b.waiver_text).toBe('Own risk.')
    expect(b.waiver_accepted_at).toBe('2030-01-06T15:00:00+00:00')
  })

  it('a guest booking with no waiver has nulls', async () => {
    rpcs.get_guest_booking = [{ ...base, waiver_text: null, waiver_accepted_at: null }]
    const b = await fetchGuestBooking('CB-7KQ2XD', 'tok')
    expect(b.waiver_text).toBeNull()
    expect(b.waiver_accepted_at).toBeNull()
  })

  it("an owner's booking asks for and carries the waiver columns", async () => {
    tables.bookings = [{
      ...base, user_id: 'u1', during: '["2030-01-06 23:00:00+00","2030-01-07 00:00:00+00")',
      parent_booking_id: null, courts: { name: 'Pickleball 1', sport: 'pickleball' },
      waiver_text: 'Own risk.', waiver_accepted_at: '2030-01-06T15:00:00+00:00',
    }]
    tables.booking_changes = []
    const b = await fetchOwnBooking('CB-7KQ2XD')
    expect(b.waiver_text).toBe('Own risk.')
    expect(b.waiver_accepted_at).toBe('2030-01-06T15:00:00+00:00')
    const own = selects.find(([t, c]) => t === 'bookings' && /\btotal_amount\b/.test(c))?.[1] ?? ''
    expect(own).toMatch(/\bwaiver_text\b/)
    expect(own).toMatch(/\bwaiver_accepted_at\b/)
  })
})
