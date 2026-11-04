import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), select: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))
import { fetchShowcaseApprovals, setVenueShowcaseApproval } from './api'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.from.mockReturnValue({ select: mocks.select })
})

it('reads platform approval keyed by venue id without consulting legacy opt-in', async () => {
  const rows = [{ id: 'v1', showcase_approved: true }]
  mocks.select.mockResolvedValue({ data: rows, error: null })
  expect(await fetchShowcaseApprovals()).toEqual(rows)
  expect(mocks.from).toHaveBeenCalledWith('venues')
  expect(mocks.select).toHaveBeenCalledWith('id, showcase_approved')
})

it.each([true, false])('sends the explicit venue and approval %s to the protected RPC', async (approved) => {
  mocks.rpc.mockResolvedValue({ data: null, error: null })
  await setVenueShowcaseApproval({ venueId: 'v1', approved })
  expect(mocks.rpc).toHaveBeenCalledWith('set_venue_showcase_approval', { p_venue_id: 'v1', p_approved: approved })
  expect(mocks.from).not.toHaveBeenCalled()
})

it('retains authorization error details from the RPC', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Only platform admins can change Showcase approval.', code: 'P0001', hint: 'not_platform_admin' } })
  await expect(setVenueShowcaseApproval({ venueId: 'v1', approved: true })).rejects.toMatchObject({ code: 'P0001', hint: 'not_platform_admin' })
})

it('rejects read failures instead of returning an empty approval list', async () => {
  mocks.select.mockResolvedValue({ data: null, error: { message: 'Read failed', code: '42501' } })
  await expect(fetchShowcaseApprovals()).rejects.toMatchObject({ message: 'Read failed', code: '42501' })
})
