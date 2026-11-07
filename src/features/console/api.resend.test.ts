import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))

const { supabase } = await import('../../lib/supabase')
const { resendOwnerInvite } = await import('./api')

beforeEach(() => {
  vi.mocked(supabase.functions.invoke).mockReset()
})

describe('resendOwnerInvite (T14.5d)', () => {
  it.each(['invite', 'link', 'welcome'] as const)('returns what the function sent: %s', async (sent) => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { ok: true, sent }, error: null } as never)
    expect(await resendOwnerInvite({ venueId: 'v1', email: 'a@b.co' })).toEqual({ sent })
    expect(supabase.functions.invoke).toHaveBeenCalledWith('invite-venue-owner', { body: { venue_id: 'v1', email: 'a@b.co' } })
  })

  it.each([{ ok: true, invited: false }, { ok: true, sent: 'none' }, { ok: true, sent: 'bogus' }])('throws ApiError for an unknown outcome %j', async (data) => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data, error: null } as never)
    await expect(resendOwnerInvite({ venueId: 'v1', email: 'a@b.co' })).rejects.toMatchObject({
      name: 'ApiError',
      message: "We couldn't send the invite.",
    })
  })
})
