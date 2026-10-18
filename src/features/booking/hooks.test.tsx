import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { cancelBooking, createBooking, submitPaymentProof } from './api'
import { useCancelBooking, useCreateBooking, useSubmitPaymentProof } from './hooks'

vi.mock('./api', () => ({ cancelBooking: vi.fn(), createBooking: vi.fn(), submitPaymentProof: vi.fn() }))

function setup() {
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidatedKeys = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey)
  return { wrapper, invalidatedKeys }
}

describe('booking mutations keep My bookings fresh', () => {
  it('cancelling refreshes the booking, the grid and My bookings', async () => {
    vi.mocked(cancelBooking).mockResolvedValue()
    const { wrapper, invalidatedKeys } = setup()
    const { result } = renderHook(() => useCancelBooking('CB-7KQ2XD', null), { wrapper })
    await act(() => result.current.mutateAsync({ bookingId: 'b1', reason: '' }))
    expect(invalidatedKeys()).toEqual(expect.arrayContaining([['booking', 'CB-7KQ2XD', null], ['availability'], ['my-bookings']]))
  })

  it('creating a booking or submitting a proof refreshes My bookings', async () => {
    vi.mocked(createBooking).mockResolvedValue({ id: 'b1', referenceCode: 'CB-7KQ2XD', guestToken: null })
    vi.mocked(submitPaymentProof).mockResolvedValue()
    const { wrapper, invalidatedKeys } = setup()
    const create = renderHook(() => useCreateBooking(), { wrapper })
    await act(() => create.result.current.mutateAsync({ courtId: 'c1', start: '2030-01-07T09:00:00.000Z', slots: 1, contact: { name: 'Pat' } }))
    const proof = renderHook(() => useSubmitPaymentProof('CB-7KQ2XD', null), { wrapper })
    await act(() => proof.result.current.mutateAsync({ method: 'gcash', amount: 500, referenceNumber: '', file: new File(['x'], 'p.png') }))
    expect(invalidatedKeys().filter((k) => k?.[0] === 'my-bookings')).toHaveLength(2)
  })
})
