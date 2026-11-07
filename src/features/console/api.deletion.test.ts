// T17.28: the console api for guarded deletion: delete_lead, venue_deletion_preview and the delete-unused-venue function.
import { FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } } }))

const { deleteLead, fetchVenueDeletionPreview, deleteUnusedVenue, retryVenueFileCleanup } = await import('./api')
const { supabase } = await import('../../lib/supabase')

beforeEach(() => {
  vi.mocked(supabase.rpc).mockReset()
  vi.mocked(supabase.functions.invoke).mockReset()
})

const preview = {
  slug: 'e2e-alpha', deletable: true, blockers: [],
  counts: { bookings: 0, payments: 0, checkouts: 0, charges: 0, invoices: 0, open_play_sessions: 0, courts: 2, members: 3 },
}

describe('deleteLead', () => {
  it('calls delete_lead with the lead id', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never)
    await expect(deleteLead('l-1')).resolves.toBeUndefined()
    expect(supabase.rpc).toHaveBeenCalledWith('delete_lead', { p_lead_id: 'l-1' })
  })

  it('throws an ApiError with the database hint', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: 'gone', code: 'P0001', hint: 'lead_not_found' } } as never)
    await expect(deleteLead('l-1')).rejects.toMatchObject({ name: 'ApiError', hint: 'lead_not_found' })
  })
})

describe('fetchVenueDeletionPreview', () => {
  it('calls venue_deletion_preview and returns slug, deletable, blockers and counts', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: preview, error: null } as never)
    expect(await fetchVenueDeletionPreview('v-1')).toEqual(preview)
    expect(supabase.rpc).toHaveBeenCalledWith('venue_deletion_preview', { p_venue_id: 'v-1' })
  })

  it('keeps the blockers in the order the database gives', async () => {
    const blocked = { ...preview, deletable: false, blockers: ['protected', 'bookings', 'invoices'] }
    vi.mocked(supabase.rpc).mockResolvedValue({ data: blocked, error: null } as never)
    expect((await fetchVenueDeletionPreview('v-1')).blockers).toEqual(['protected', 'bookings', 'invoices'])
  })

  it('throws an ApiError with the hint', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: 'no', code: 'P0001', hint: 'not_platform_admin' } } as never)
    await expect(fetchVenueDeletionPreview('v-1')).rejects.toMatchObject({ name: 'ApiError', hint: 'not_platform_admin' })
  })
})

describe('deleteUnusedVenue', () => {
  it('invokes delete-unused-venue with action delete, venue_id and confirm_slug, and returns the cleanup state', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { venue_id: 'v-1', slug: 'e2e-alpha', cleanup: 'done' }, error: null } as never)
    const out = await deleteUnusedVenue({ venueId: 'v-1', confirmSlug: 'e2e-alpha' })
    expect(supabase.functions.invoke).toHaveBeenCalledWith('delete-unused-venue', { body: { action: 'delete', venue_id: 'v-1', confirm_slug: 'e2e-alpha' } })
    expect(out.cleanup).toBe('done')
  })

  it('returns pending when the function says file cleanup is pending', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { venue_id: 'v-1', slug: 's', cleanup: 'pending' }, error: null } as never)
    expect((await deleteUnusedVenue({ venueId: 'v-1', confirmSlug: 's' })).cleanup).toBe('pending')
  })

  it.each([
    [409, 'confirmation_mismatch', 'The subdomain does not match.'],
    [409, 'venue_in_use', 'This venue has history.'],
    [403, 'not_platform_admin', 'Platform admins only.'],
  ])('throws ApiError(message, status %s, hint %s) from the function body', async (status, code, message) => {
    const response = new Response(JSON.stringify({ code, message }), { status })
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: null, error: new FunctionsHttpError(response) } as never)
    await expect(deleteUnusedVenue({ venueId: 'v-1', confirmSlug: 'x' })).rejects.toMatchObject({
      name: 'ApiError', message, code: String(status), hint: code,
    })
  })

  it('throws a connection ApiError when the function cannot be reached', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: null, error: new Error('Failed to fetch') } as never)
    await expect(deleteUnusedVenue({ venueId: 'v-1', confirmSlug: 'x' })).rejects.toMatchObject({
      name: 'ApiError', message: expect.stringMatching(/connection|reach/i),
    })
  })
})

describe('retryVenueFileCleanup', () => {
  it('invokes delete-unused-venue with action retry and the venue id only', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { venue_id: 'v-1', cleanup: 'pending' }, error: null } as never)
    const out = await retryVenueFileCleanup('v-1')
    expect(supabase.functions.invoke).toHaveBeenCalledWith('delete-unused-venue', { body: { action: 'retry', venue_id: 'v-1' } })
    expect(out.cleanup).toBe('pending')
  })

  it('throws the function error as an ApiError', async () => {
    const response = new Response(JSON.stringify({ code: 'not_platform_admin', message: 'Platform admins only.' }), { status: 403 })
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: null, error: new FunctionsHttpError(response) } as never)
    await expect(retryVenueFileCleanup('v-1')).rejects.toMatchObject({ name: 'ApiError', hint: 'not_platform_admin' })
  })
})
