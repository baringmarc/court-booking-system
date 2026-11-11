import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), select: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))
import { fetchWalkIns, setWalkIns } from './api'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.from.mockReturnValue({ select: mocks.select })
})

it('T18.4 reads every venue\'s walk-ins switch in one request', async () => {
  const rows = [{ venue_id: 'v1', walk_ins_enabled: true }]
  mocks.select.mockResolvedValue({ data: rows, error: null })
  expect(await fetchWalkIns()).toEqual(rows)
  expect(mocks.from).toHaveBeenCalledTimes(1)
  expect(mocks.from).toHaveBeenCalledWith('venue_settings')
  expect(mocks.select).toHaveBeenCalledWith('venue_id, walk_ins_enabled')
})

it.each([true, false])('T18.4 sends the explicit venue and enabled=%s to set_walk_ins', async (enabled) => {
  mocks.rpc.mockResolvedValue({ data: null, error: null })
  await setWalkIns({ venueId: 'v1', enabled })
  expect(mocks.rpc).toHaveBeenCalledWith('set_walk_ins', { p_venue_id: 'v1', p_enabled: enabled })
  expect(mocks.from).not.toHaveBeenCalled()
})

it('T18.4 retains the RPC error details', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Only platform admins', code: 'P0001', hint: 'not_platform_admin' } })
  await expect(setWalkIns({ venueId: 'v1', enabled: true })).rejects.toMatchObject({ code: 'P0001', hint: 'not_platform_admin' })
})

it('T18.4 rejects read failures instead of returning an empty list', async () => {
  mocks.select.mockResolvedValue({ data: null, error: { message: 'Read failed', code: '42501' } })
  await expect(fetchWalkIns()).rejects.toMatchObject({ message: 'Read failed', code: '42501' })
})
