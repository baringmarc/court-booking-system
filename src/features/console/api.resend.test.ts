import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))

const { supabase } = await import('../../lib/supabase')
const { resendOwnerInvite } = await import('./api')

beforeEach(() => {
  vi.mocked(supabase.functions.invoke).mockReset()
})

describe('resendOwnerInvite (T14.5d)', () => {
  it.each(['invite', 'link', 'none'] as const)('returns what the function sent: %s', async (sent) => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { ok: true, sent }, error: null } as never)
    expect(await resendOwnerInvite({ venueId: 'v1', email: 'a@b.co' })).toEqual({ sent })
    expect(supabase.functions.invoke).toHaveBeenCalledWith('invite-venue-owner', { body: { venue_id: 'v1', email: 'a@b.co' } })
  })

  it('treats a response without a known outcome as nothing sent', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { ok: true, invited: false }, error: null } as never)
    expect(await resendOwnerInvite({ venueId: 'v1', email: 'a@b.co' })).toEqual({ sent: 'none' })
  })
})
