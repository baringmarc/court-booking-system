import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), select: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))
import { fetchOnlinePayments, setOnlinePayments } from './api'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.from.mockReturnValue({ select: mocks.select })
})

it('T18.2 reads every venue\'s online payments switch in one request', async () => {
  const rows = [{ venue_id: 'v1', online_payments_enabled: true }]
  mocks.select.mockResolvedValue({ data: rows, error: null })
  expect(await fetchOnlinePayments()).toEqual(rows)
  expect(mocks.from).toHaveBeenCalledTimes(1)
  expect(mocks.from).toHaveBeenCalledWith('venue_settings')
  expect(mocks.select).toHaveBeenCalledWith('venue_id, online_payments_enabled')
})

it.each([true, false])('T18.2 sends the explicit venue and enabled=%s to set_online_payments', async (enabled) => {
  mocks.rpc.mockResolvedValue({ data: null, error: null })
  await setOnlinePayments({ venueId: 'v1', enabled })
  expect(mocks.rpc).toHaveBeenCalledWith('set_online_payments', { p_venue_id: 'v1', p_enabled: enabled })
  expect(mocks.from).not.toHaveBeenCalled()
})

it('T18.2 retains the RPC error details', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Only platform admins', code: 'P0001', hint: 'not_platform_admin' } })
  await expect(setOnlinePayments({ venueId: 'v1', enabled: true })).rejects.toMatchObject({ code: 'P0001', hint: 'not_platform_admin' })
})

it('T18.2 rejects read failures instead of returning an empty list', async () => {
  mocks.select.mockResolvedValue({ data: null, error: { message: 'Read failed', code: '42501' } })
  await expect(fetchOnlinePayments()).rejects.toMatchObject({ message: 'Read failed', code: '42501' })
})
