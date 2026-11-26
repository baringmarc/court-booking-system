// T35.1: useAvailability can be switched off (a draft venue's dashboard must not call the public RPC).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAvailability } from './api'
import { useAvailability } from './hooks'

vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchAvailability: vi.fn() }))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useAvailability enabled option', () => {
  beforeEach(() => {
    vi.mocked(fetchAvailability).mockReset().mockResolvedValue([])
  })

  it('does not call fetchAvailability with { enabled: false }', async () => {
    const { result } = renderHook(() => useAvailability('2030-01-07', { enabled: false }), { wrapper })
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchAvailability).not.toHaveBeenCalled()
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('calls fetchAvailability with no options', async () => {
    renderHook(() => useAvailability('2030-01-07'), { wrapper })
    await waitFor(() => expect(fetchAvailability).toHaveBeenCalledWith('2030-01-07'))
  })

  it('calls fetchAvailability with { enabled: true }', async () => {
    renderHook(() => useAvailability('2030-01-07', { enabled: true }), { wrapper })
    await waitFor(() => expect(fetchAvailability).toHaveBeenCalledTimes(1))
  })
})
