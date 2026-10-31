import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'
import { adminCancelBooking, adminKeys, rescheduleBooking } from './api'
import { useAdminCancelBooking, useRescheduleBooking } from './hooks'

vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), rescheduleBooking: vi.fn(), adminCancelBooking: vi.fn() }))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  // A cached "no moved parts" answer, as the cancel form holds it while the booking panel stays open.
  client.setQueryData(adminKeys.movedParts('b1'), [])
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('moved parts stay fresh', () => {
  beforeEach(() => {
    setCurrentVenue({ id: 'venue-a', slug: 'a-venue', status: 'active' })
    vi.mocked(rescheduleBooking).mockReset().mockResolvedValue({ continuationReference: 'CB-MOVEDA' })
    vi.mocked(adminCancelBooking).mockReset().mockResolvedValue('cancelled' as never)
  })

  it('a reschedule marks the moved-parts answer stale, so the cancel form warns about the new part', async () => {
    const { client, wrapper } = setup()
    const { result } = renderHook(() => useRescheduleBooking(), { wrapper })
    await act(() => result.current.mutateAsync({ bookingId: 'b1', fromStart: 'a', courtId: 'c', start: 'b', reason: 'Rain' }))
    await waitFor(() => expect(client.getQueryState(adminKeys.movedParts('b1'))?.isInvalidated).toBe(true))
  })

  it('cancelling a booking marks it stale too (a moved part may have been the one cancelled)', async () => {
    const { client, wrapper } = setup()
    const { result } = renderHook(() => useAdminCancelBooking(), { wrapper })
    await act(() => result.current.mutateAsync({ bookingId: 'b1', reason: 'Roof repair' }))
    await waitFor(() => expect(client.getQueryState(adminKeys.movedParts('b1'))?.isInvalidated).toBe(true))
  })
})
