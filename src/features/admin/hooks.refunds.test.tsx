// T30.6: the refund hooks. Saving a refund refreshes everything that shows it: the bookings lists, the owed count on the
// dashboard, earnings (Refunded and Net) and the player's booking page.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'
import { bookingKeys } from '../booking/hooks'
import { adminKeys, fetchRefundsOwedCount, updateRefund } from './api'
import { DEFAULT_FILTERS } from './bookingFilters'
import { useRefundsOwedCount, useUpdateRefund } from './hooks'

vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), updateRefund: vi.fn(), fetchRefundsOwedCount: vi.fn() }))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  client.setQueryData(adminKeys.bookings(DEFAULT_FILTERS), { bookings: [], truncated: false })
  client.setQueryData(adminKeys.refundsOwed(), 2)
  client.setQueryData(adminKeys.earnings('2030-01-07', '2030-01-07'), {})
  client.setQueryData([...bookingKeys.allDetails, 'CB-7KQ2XD'], {})
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('refund hooks (T30.6)', () => {
  beforeEach(() => {
    setCurrentVenue({ id: 'venue-a', slug: 'a-venue', status: 'active' })
    vi.mocked(updateRefund).mockReset().mockResolvedValue(undefined)
    vi.mocked(fetchRefundsOwedCount).mockReset().mockResolvedValue(3)
  })

  it('useRefundsOwedCount returns the count from the api', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useRefundsOwedCount(), { wrapper })
    await waitFor(() => expect(result.current.data).toBe(3))
    expect(fetchRefundsOwedCount).toHaveBeenCalled()
  })

  it('useUpdateRefund sends the input to updateRefund', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useUpdateRefund(), { wrapper })
    await act(() => result.current.mutateAsync({ refundId: 'r1', status: 'owed' }))
    expect(vi.mocked(updateRefund).mock.calls[0][0]).toEqual({ refundId: 'r1', status: 'owed' })
  })

  it('a saved refund marks the bookings lists, the owed count, earnings and the player pages stale', async () => {
    const { client, wrapper } = setup()
    const { result } = renderHook(() => useUpdateRefund(), { wrapper })
    await act(() => result.current.mutateAsync({ refundId: 'r1', status: 'settled', amount: 900, method: 'gcash', settledOn: '2030-01-07' }))
    await waitFor(() => {
      expect(client.getQueryState(adminKeys.bookings(DEFAULT_FILTERS))?.isInvalidated).toBe(true)
      expect(client.getQueryState(adminKeys.refundsOwed())?.isInvalidated).toBe(true)
      expect(client.getQueryState(adminKeys.earnings('2030-01-07', '2030-01-07'))?.isInvalidated).toBe(true)
      expect(client.getQueryState([...bookingKeys.allDetails, 'CB-7KQ2XD'])?.isInvalidated).toBe(true)
    })
  })

  it('a failed save surfaces the error', async () => {
    vi.mocked(updateRefund).mockRejectedValue(new Error('Choose how the refund was made.'))
    const { wrapper } = setup()
    const { result } = renderHook(() => useUpdateRefund(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ refundId: 'r1', status: 'settled', settledOn: '2030-01-07' }).catch(() => undefined) })
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error))
  })
})
