// T33.3: createBookingGroup calls create_booking_group (SPEC §6) and maps its rows, lead first.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpcCalls: [string, Record<string, unknown>][] = []
let rpcResult: { data: unknown; error: { message: string; code?: string; hint?: string } | null } = { data: null, error: null }

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args])
      return Promise.resolve(rpcResult)
    }),
  },
}))

const { createBookingGroup } = await import('./api')
const { ApiError } = await import('../../lib/queryClient')

const rows = (token: string | null) => [
  { booking_group_id: 'g1', id: 'b1', reference_code: 'CB-LEAD01', court_id: 'c1', guest_token: token },
  { booking_group_id: 'g1', id: 'b2', reference_code: 'CB-PART02', court_id: 'c2', guest_token: token },
]

const items = [
  { courtId: 'c1', start: '2030-01-06T23:00:00.000Z', slots: 2 },
  { courtId: 'c2', start: '2030-01-07T06:00:00.000Z', slots: 1 },
]
const contact = { name: 'Gina', email: 'g@example.com', phone: '0917' }

beforeEach(() => {
  rpcCalls.length = 0
  rpcResult = { data: rows('tok'), error: null }
})

describe('createBookingGroup', () => {
  it('calls create_booking_group with snake_case items, the contact and the waiver flag; it never sends a price', async () => {
    await createBookingGroup({ items, contact, waiverAccepted: true })
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0][0]).toBe('create_booking_group')
    expect(rpcCalls[0][1]).toEqual({
      p_items: [
        { court_id: 'c1', start: '2030-01-06T23:00:00.000Z', slots: 2 },
        { court_id: 'c2', start: '2030-01-07T06:00:00.000Z', slots: 1 },
      ],
      p_guest_name: 'Gina',
      p_guest_email: 'g@example.com',
      p_guest_phone: '0917',
      p_waiver_accepted: true,
    })
  })

  it('sends p_waiver_accepted false when the flag is missing, and no contact for a signed-in player', async () => {
    await createBookingGroup({ items })
    const args = rpcCalls[0][1]
    expect(args.p_waiver_accepted).toBe(false)
    expect(args.p_guest_name).toBeUndefined()
    expect(args.p_guest_email).toBeUndefined()
    expect(args.p_guest_phone).toBeUndefined()
  })

  it('maps the rows in the order returned (lead first) and takes the guest token from the first row', async () => {
    await expect(createBookingGroup({ items, contact })).resolves.toEqual({
      groupId: 'g1',
      bookings: [
        { id: 'b1', referenceCode: 'CB-LEAD01', courtId: 'c1' },
        { id: 'b2', referenceCode: 'CB-PART02', courtId: 'c2' },
      ],
      guestToken: 'tok',
    })
  })

  it('has a null guest token for a signed-in player', async () => {
    rpcResult = { data: rows(null), error: null }
    const created = await createBookingGroup({ items })
    expect(created.guestToken).toBeNull()
    expect(created.bookings[0].referenceCode).toBe('CB-LEAD01')
  })

  it('throws the generic message on an empty result', async () => {
    rpcResult = { data: [], error: null }
    await expect(createBookingGroup({ items, contact })).rejects.toThrow('The booking could not be created. Please try again.')
  })

  it('keeps the RPC error code and hint as an ApiError', async () => {
    rpcResult = { data: null, error: { message: 'Badminton 2: Sorry, that time was just booked. Please pick another slot.', code: 'P0001', hint: 'slot_unavailable' } }
    const failure = await createBookingGroup({ items, contact }).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as InstanceType<typeof ApiError>).hint).toBe('slot_unavailable')
    expect((failure as Error).message).toBe('Badminton 2: Sorry, that time was just booked. Please pick another slot.')
  })
})
