// T14.8: the venues overview, suspend and reactivate go through the RPCs of the same names.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }))

const { fetchVenuesOverview, suspendVenue, reactivateVenue } = await import('./api')

beforeEach(() => { rpc.mockReset() })

describe('venues overview api', () => {
  it('fetchVenuesOverview calls venues_overview and returns the array as is', async () => {
    const rows = [{ venue_id: 'v1', slug: 'e2e-a', name: 'E2E A', status: 'active', month_transactions: 3, month_total: 30, open_invoices: 1 }]
    rpc.mockResolvedValue({ data: rows, error: null })
    expect(await fetchVenuesOverview()).toEqual(rows)
    expect(rpc).toHaveBeenCalledWith('venues_overview')
  })

  it('fetchVenuesOverview returns an empty array when the RPC returns none', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    expect(await fetchVenuesOverview()).toEqual([])
  })

  it('suspendVenue calls suspend_venue with p_venue_id', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await suspendVenue('v1')
    expect(rpc).toHaveBeenCalledWith('suspend_venue', { p_venue_id: 'v1' })
  })

  it('reactivateVenue calls reactivate_venue with p_venue_id', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await reactivateVenue('v1')
    expect(rpc).toHaveBeenCalledWith('reactivate_venue', { p_venue_id: 'v1' })
  })

  it('suspendVenue rejects when the RPC fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'x', details: '', hint: 'not_active', code: 'P0001', name: 'PostgrestError' } })
    await expect(suspendVenue('v1')).rejects.toBeTruthy()
  })
})
