// T33.3: useCreateBookingGroup is shaped like useCreateBooking: the guest's private-link email is asked for with the
// LEAD booking's reference, and a settled create refreshes the grid and My bookings.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBookingGroup, requestGuestLinkEmail, type CreatedBookingGroup } from './api'
import { useCreateBookingGroup } from './hooks'

vi.mock('./api', () => ({ createBookingGroup: vi.fn(), requestGuestLinkEmail: vi.fn() }))

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidatedKeys = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey)
  return { wrapper, invalidatedKeys }
}

const created = (guestToken: string | null): CreatedBookingGroup => ({
  groupId: 'g1',
  bookings: [
    { id: 'b1', referenceCode: 'CB-LEAD01', courtId: 'c1' },
    { id: 'b2', referenceCode: 'CB-PART02', courtId: 'c2' },
  ],
  guestToken,
})
const input = {
  items: [{ courtId: 'c1', start: '2030-01-07T09:00:00.000Z', slots: 1 }, { courtId: 'c2', start: '2030-01-07T11:00:00.000Z', slots: 1 }],
  contact: { name: 'Gina' },
}

beforeEach(() => {
  vi.mocked(requestGuestLinkEmail).mockReset().mockResolvedValue()
  vi.mocked(createBookingGroup).mockReset()
})

describe('useCreateBookingGroup', () => {
  it('passes the input to createBookingGroup and returns its result', async () => {
    vi.mocked(createBookingGroup).mockResolvedValue(created('tok'))
    const { wrapper } = setup()
    const { result } = renderHook(() => useCreateBookingGroup(), { wrapper })
    await expect(act(() => result.current.mutateAsync(input))).resolves.toEqual(created('tok'))
    expect(createBookingGroup).toHaveBeenCalledWith(input)
  })

  it("asks for the guest's private-link email with the lead's reference (the first booking) and the token", async () => {
    vi.mocked(createBookingGroup).mockResolvedValue(created('tok'))
    const { wrapper } = setup()
    const { result } = renderHook(() => useCreateBookingGroup(), { wrapper })
    await act(() => result.current.mutateAsync(input))
    expect(requestGuestLinkEmail).toHaveBeenCalledTimes(1)
    expect(requestGuestLinkEmail).toHaveBeenCalledWith({ referenceCode: 'CB-LEAD01', token: 'tok' })
  })

  it("doesn't ask for it for a signed-in player (no token)", async () => {
    vi.mocked(createBookingGroup).mockResolvedValue(created(null))
    const { wrapper } = setup()
    const { result } = renderHook(() => useCreateBookingGroup(), { wrapper })
    await act(() => result.current.mutateAsync(input))
    expect(requestGuestLinkEmail).not.toHaveBeenCalled()
  })

  it('a failed email request never fails the booking', async () => {
    vi.mocked(requestGuestLinkEmail).mockReset().mockRejectedValue(new Error('offline'))
    vi.mocked(createBookingGroup).mockResolvedValue(created('tok'))
    const { wrapper } = setup()
    const { result } = renderHook(() => useCreateBookingGroup(), { wrapper })
    await expect(act(() => result.current.mutateAsync(input))).resolves.toMatchObject({ groupId: 'g1' })
  })

  it('refreshes the grid and My bookings when it settles, on success and on failure', async () => {
    vi.mocked(createBookingGroup).mockResolvedValueOnce(created(null)).mockRejectedValueOnce(new Error('slot taken'))
    const { wrapper, invalidatedKeys } = setup()
    const { result } = renderHook(() => useCreateBookingGroup(), { wrapper })
    await act(() => result.current.mutateAsync(input))
    expect(invalidatedKeys().filter((k) => k?.[1] === 'availability')).toHaveLength(1)
    expect(invalidatedKeys().filter((k) => k?.[1] === 'my-bookings')).toHaveLength(1)
    await act(() => result.current.mutateAsync(input).catch(() => {}))
    expect(invalidatedKeys().filter((k) => k?.[1] === 'availability')).toHaveLength(2)
    expect(invalidatedKeys().filter((k) => k?.[1] === 'my-bookings')).toHaveLength(2)
  })
})
