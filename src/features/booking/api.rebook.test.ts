// T30.4: createBooking passes the reference being repeated as p_rebook_of_reference (SPEC §6 create_booking).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpcCalls: [string, Record<string, unknown>][] = []

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args])
      return Promise.resolve({ data: [{ id: 'b1', reference_code: 'CB-AAAAAA', guest_token: null }], error: null })
    }),
  },
}))

const { createBooking } = await import('./api')

beforeEach(() => {
  rpcCalls.length = 0
})

const base = { courtId: 'c1', start: '2030-01-14T09:00:00.000Z', slots: 2, contact: { name: 'Gina', email: 'g@example.com', phone: '' } }

describe('createBooking rebookOfReference', () => {
  it('sends p_rebook_of_reference when given', async () => {
    await createBooking({ ...base, rebookOfReference: 'CB-7KQ2XD' })
    expect(rpcCalls[0][0]).toBe('create_booking')
    expect(rpcCalls[0][1]).toMatchObject({ p_court_id: 'c1', p_start: base.start, p_slots: 2, p_rebook_of_reference: 'CB-7KQ2XD' })
  })

  it('sends nothing (undefined, not a blank) when not given', async () => {
    await createBooking(base)
    expect(rpcCalls[0][0]).toBe('create_booking')
    expect(rpcCalls[0][1].p_rebook_of_reference).toBeUndefined()
  })
})
