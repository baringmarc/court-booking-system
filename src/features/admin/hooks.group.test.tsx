// T33.4: useAdminGroup reads a checkout by group id, is off without an id, and is refreshed whenever the admin bookings
// are invalidated (it lives under adminKeys.allBookings()).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'
import { adminKeys, fetchAdminGroup, type AdminGroup } from './api'
import { useAdminGroup } from './hooks'

vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchAdminGroup: vi.fn() }))

const group: AdminGroup = { id: 'g1', lead_reference_code: 'CB-LEAD01', bookings: [] }

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('useAdminGroup', () => {
  beforeEach(() => {
    setCurrentVenue({ id: 'venue-a', slug: 'a-venue', status: 'active' })
    vi.mocked(fetchAdminGroup).mockReset().mockResolvedValue(group)
  })

  it('returns the group read by id', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useAdminGroup('g1'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(group))
    expect(fetchAdminGroup).toHaveBeenCalledWith('g1')
  })

  it.each([null, undefined])('is disabled without an id (%s)', async (id) => {
    const { client, wrapper } = setup()
    const { result } = renderHook(() => useAdminGroup(id), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.isPending).toBe(true)
    expect(fetchAdminGroup).not.toHaveBeenCalled()
    expect(client.getQueryData(adminKeys.group(''))).toBeUndefined()
  })

  it('is cached under adminKeys.group(id)', async () => {
    const { client, wrapper } = setup()
    const { result } = renderHook(() => useAdminGroup('g1'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(group))
    expect(client.getQueryData(adminKeys.group('g1'))).toEqual(group)
  })

  it('reads again when the admin bookings are invalidated (after a review or a cancel)', async () => {
    const { client, wrapper } = setup()
    const { result } = renderHook(() => useAdminGroup('g1'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(group))
    expect(fetchAdminGroup).toHaveBeenCalledTimes(1)
    vi.mocked(fetchAdminGroup).mockResolvedValue({ ...group, lead_reference_code: 'CB-NEWLD1' })
    await client.invalidateQueries({ queryKey: adminKeys.allBookings() })
    await waitFor(() => expect(result.current.data?.lead_reference_code).toBe('CB-NEWLD1'))
    expect(fetchAdminGroup).toHaveBeenCalledTimes(2)
  })
})
