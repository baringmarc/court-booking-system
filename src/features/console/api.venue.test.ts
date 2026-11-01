// T14.6: createVenue (create_venue RPC) and inviteVenueOwner (invite-venue-owner function).
import { FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } } }))

const { createVenue, inviteVenueOwner } = await import('./api')
const { supabase } = await import('../../lib/supabase')

beforeEach(() => {
  vi.mocked(supabase.rpc).mockReset()
  vi.mocked(supabase.functions.invoke).mockReset()
})

describe('createVenue', () => {
  it('calls create_venue with slug, name and timezone and returns the venue id', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: 'v-123', error: null } as never)
    const id = await createVenue({ slug: 'smash', name: 'Smash', timezone: 'Asia/Manila' })
    expect(supabase.rpc).toHaveBeenCalledWith('create_venue', { p_slug: 'smash', p_name: 'Smash', p_timezone: 'Asia/Manila' })
    expect(id).toBe('v-123')
  })

  it('throws an ApiError whose hint is the database hint', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: 'taken', code: 'P0001', hint: 'slug_taken' } } as never)
    await expect(createVenue({ slug: 'smash', name: 'Smash', timezone: 'Asia/Manila' })).rejects.toMatchObject({ name: 'ApiError', hint: 'slug_taken' })
  })
})

describe('inviteVenueOwner', () => {
  it('invokes invite-venue-owner with venue_id and email and returns { invited }', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { invited: true }, error: null } as never)
    const out = await inviteVenueOwner({ venueId: 'v-123', email: 'ana@example.com' })
    expect(supabase.functions.invoke).toHaveBeenCalledWith('invite-venue-owner', { body: { venue_id: 'v-123', email: 'ana@example.com' } })
    expect(out).toEqual({ invited: true })
  })

  it('throws ApiError with the function code as hint and its message', async () => {
    const response = new Response(JSON.stringify({ code: 'not_platform_admin', message: 'Platform admins only.' }), { status: 403 })
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: null, error: new FunctionsHttpError(response) } as never)
    await expect(inviteVenueOwner({ venueId: 'v', email: 'a@b.co' })).rejects.toMatchObject({
      name: 'ApiError', message: 'Platform admins only.', hint: 'not_platform_admin',
    })
  })
})
