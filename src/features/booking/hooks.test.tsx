import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { cancelBooking, createBooking, requestGuestLinkEmail, submitPaymentProof } from './api'
import { useCancelBooking, useCreateBooking, useSubmitPaymentProof } from './hooks'

vi.mock('./api', () => ({ cancelBooking: vi.fn(), createBooking: vi.fn(), requestGuestLinkEmail: vi.fn(), submitPaymentProof: vi.fn() }))

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
    expect(invalidatedKeys()).toEqual(expect.arrayContaining([['booking', 'CB-7KQ2XD', null], ['00000000-0000-4000-8000-0000000000a1', 'availability'], ['my-bookings']]))
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

describe('the guest booking email', () => {
  it('asks for the private-link email after a guest booking', async () => {
    vi.mocked(requestGuestLinkEmail).mockReset().mockResolvedValue()
    vi.mocked(createBooking).mockResolvedValue({ id: 'b1', referenceCode: 'CB-7KQ2XD', guestToken: 'tok' })
    const { wrapper } = setup()
    const create = renderHook(() => useCreateBooking(), { wrapper })
    await act(() => create.result.current.mutateAsync({ courtId: 'c1', start: '2030-01-07T09:00:00.000Z', slots: 1, contact: { name: 'Gina' } }))
    expect(requestGuestLinkEmail).toHaveBeenCalledWith({ referenceCode: 'CB-7KQ2XD', token: 'tok' })
  })

  it("doesn't ask for it for a signed-in player", async () => {
    vi.mocked(requestGuestLinkEmail).mockReset().mockResolvedValue()
    vi.mocked(createBooking).mockResolvedValue({ id: 'b1', referenceCode: 'CB-7KQ2XD', guestToken: null })
    const { wrapper } = setup()
    const create = renderHook(() => useCreateBooking(), { wrapper })
    await act(() => create.result.current.mutateAsync({ courtId: 'c1', start: '2030-01-07T09:00:00.000Z', slots: 1 }))
    expect(requestGuestLinkEmail).not.toHaveBeenCalled()
  })

  it('a failed email request never fails the booking', async () => {
    vi.mocked(requestGuestLinkEmail).mockReset().mockRejectedValue(new Error('offline'))
    vi.mocked(createBooking).mockResolvedValue({ id: 'b1', referenceCode: 'CB-7KQ2XD', guestToken: 'tok' })
    const { wrapper } = setup()
    const create = renderHook(() => useCreateBooking(), { wrapper })
    await expect(
      act(() => create.result.current.mutateAsync({ courtId: 'c1', start: '2030-01-07T09:00:00.000Z', slots: 1, contact: { name: 'Gina' } })),
    ).resolves.toMatchObject({ referenceCode: 'CB-7KQ2XD' })
  })
})
