// T24.2: the console invites a venue's staff through the same function as the owner, with role 'staff'.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))

const { supabase } = await import('../../lib/supabase')
const { inviteVenueStaff, resendOwnerInvite } = await import('./api')

beforeEach(() => {
  vi.mocked(supabase.functions.invoke).mockReset()
})

describe('inviteVenueStaff (T24.2)', () => {
  it.each(['invite', 'link', 'welcome'] as const)('returns what the function sent (%s) and sends role staff', async (sent) => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { ok: true, sent }, error: null } as never)
    expect(await inviteVenueStaff({ venueId: 'v1', email: 'a@b.co' })).toEqual({ sent })
    expect(supabase.functions.invoke).toHaveBeenCalledWith('invite-venue-owner', { body: { venue_id: 'v1', email: 'a@b.co', role: 'staff' } })
  })

  it.each([{ ok: true, invited: false }, { ok: true, sent: 'none' }, { ok: true, sent: 'bogus' }])('throws ApiError for an unknown outcome %j', async (data) => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data, error: null } as never)
    await expect(inviteVenueStaff({ venueId: 'v1', email: 'a@b.co' })).rejects.toMatchObject({
      name: 'ApiError',
      message: "We couldn't send the invite.",
    })
  })

  it('does not add a role to the owner resend body', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { ok: true, sent: 'link' }, error: null } as never)
    await resendOwnerInvite({ venueId: 'v1', email: 'a@b.co' })
    const options = vi.mocked(supabase.functions.invoke).mock.calls[0][1] as { body: Record<string, unknown> }
    expect(options.body).toEqual({ venue_id: 'v1', email: 'a@b.co' })
    expect(options.body).not.toHaveProperty('role')
  })
})
