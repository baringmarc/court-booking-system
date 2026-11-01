// T14.7: publishing refreshes the setup status and the venue, so the checklist goes away.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'
import { fetchSetupStatus, publishVenue } from './api'
import { usePublishVenue, useSetupStatus } from './hooks'

vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchSetupStatus: vi.fn(), publishVenue: vi.fn() }))

const status = { items: [{ key: 'courts', label: 'Add a court', required: true, done: true }], ready: true }

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  // The venue as VenueProvider caches it: key ['venue', slug, user id].
  client.setQueryData(['venue', 'a-venue', 'user-1'], { id: 'venue-a', slug: 'a-venue', status: 'draft' })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('setup hooks', () => {
  beforeEach(() => {
    setCurrentVenue({ id: 'venue-a', slug: 'a-venue', status: 'draft' })
    vi.mocked(fetchSetupStatus).mockReset().mockResolvedValue(status)
    vi.mocked(publishVenue).mockReset().mockResolvedValue(undefined)
  })

  it('useSetupStatus returns the status from the api', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useSetupStatus(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(status))
  })

  it('a successful publish reads the setup status again', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => ({ status: useSetupStatus(), publish: usePublishVenue() }), { wrapper })
    await waitFor(() => expect(result.current.status.data).toEqual(status))
    expect(fetchSetupStatus).toHaveBeenCalledTimes(1)
    await act(() => result.current.publish.mutateAsync())
    expect(publishVenue).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(fetchSetupStatus).toHaveBeenCalledTimes(2))
  })

  it('a successful publish marks the cached venue stale so it is read again', async () => {
    const { client, wrapper } = setup()
    const { result } = renderHook(() => usePublishVenue(), { wrapper })
    await act(() => result.current.mutateAsync())
    expect(client.getQueryState(['venue', 'a-venue', 'user-1'])?.isInvalidated).toBe(true)
  })

  it('a failed publish does not refresh the venue and surfaces the error', async () => {
    vi.mocked(publishVenue).mockRejectedValue(new Error('Finish setting up first.'))
    const { client, wrapper } = setup()
    const { result } = renderHook(() => usePublishVenue(), { wrapper })
    await act(async () => { await result.current.mutateAsync().catch(() => undefined) })
    expect(client.getQueryState(['venue', 'a-venue', 'user-1'])?.isInvalidated).toBe(false)
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error))
  })
})
