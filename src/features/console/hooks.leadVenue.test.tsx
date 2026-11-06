// T17.25: converting a lead marks it won only after the owner invite went out; a retry reuses the created venue.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Lead } from './api'

const mocks = vi.hoisted(() => ({ create: vi.fn(), invite: vi.fn(), update: vi.fn() }))
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  createVenue: mocks.create, inviteVenueOwner: mocks.invite, updateLead: mocks.update,
}))

const { useCreateVenueFromLead } = await import('./hooks')

const lead = { id: 'lead-1', status: 'talking' } as Lead
const input = { lead, slug: 'e2e-x', name: 'E2E X', timezone: 'Asia/Manila', email: 'o@example.com' }

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return renderHook(() => useCreateVenueFromLead(), { wrapper })
}

beforeEach(() => {
  mocks.create.mockReset().mockResolvedValue('venue-1')
  mocks.invite.mockReset()
  mocks.update.mockReset().mockResolvedValue(undefined)
})

describe('useCreateVenueFromLead (T17.25)', () => {
  it('leaves the lead un-won when the invite is rejected, and a retry reuses the venue', async () => {
    mocks.invite.mockRejectedValueOnce(new Error("We couldn't send the invite.")).mockResolvedValueOnce({ invited: true })
    const { result } = setup()
    await act(async () => { await result.current.mutateAsync(input).catch(() => {}) })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledTimes(1)

    await act(async () => { await result.current.mutateAsync(input) })
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.invite).toHaveBeenLastCalledWith({ venueId: 'venue-1', email: 'o@example.com' })
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.update).toHaveBeenCalledWith('lead-1', { status: 'won' })
  })
})
