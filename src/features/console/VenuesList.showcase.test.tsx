import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tables } from '../../lib/database.types'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import type { VenueOverview } from './api'
import { ConsoleGuard } from './ConsoleGuard'
import { VenuesList } from './VenuesList'

type Approval = Pick<Tables<'venues'>, 'id' | 'showcase_approved'>
const mocks = vi.hoisted(() => ({
  approvals: vi.fn<() => Promise<Approval[]>>(),
  save: vi.fn<(input: { venueId: string; approved: boolean }) => Promise<void>>(),
  venues: vi.fn<() => Promise<VenueOverview[]>>(),
  admin: vi.fn<() => Promise<boolean>>(),
}))
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  fetchShowcaseApprovals: mocks.approvals, setVenueShowcaseApproval: mocks.save,
  fetchVenuesOverview: mocks.venues, fetchIsPlatformAdmin: mocks.admin,
}))

const venue: VenueOverview = {
  venue_id: 'v1', slug: 'e2e-showcase', name: 'E2E Showcase Courts', status: 'active',
  month_transactions: 2, month_total: 20, open_invoices: 1,
}

function mount(guarded = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}>
    {guarded ? <AuthContext.Provider value={authState('admin')}><ConsoleGuard><VenuesList /></ConsoleGuard></AuthContext.Provider> : <VenuesList />}
  </QueryClientProvider>)
}

beforeEach(() => {
  mocks.venues.mockReset().mockResolvedValue([venue])
  mocks.approvals.mockReset().mockResolvedValue([{ id: venue.venue_id, showcase_approved: false }])
  mocks.save.mockReset().mockResolvedValue(undefined)
  mocks.admin.mockReset().mockResolvedValue(true)
})

describe('T17.8 console showcase controls', () => {
  it('shows each venue approval independently and preserves existing console actions', async () => {
    mocks.venues.mockResolvedValue([venue, { ...venue, venue_id: 'v2', name: 'E2E Second', slug: 'e2e-second', status: 'suspended' }])
    mocks.approvals.mockResolvedValue([{ id: 'v2', showcase_approved: true }, { id: 'v1', showcase_approved: false }])
    mount()
    await screen.findByText('Showcase: Approved')
    const [first, second] = screen.getAllByRole('listitem').map((item) => within(item))
    expect(first.getByText('Showcase: Not approved')).toBeInTheDocument()
    expect(first.getByRole('button', { name: 'Approve showcase' })).toBeInTheDocument()
    expect(first.getByRole('button', { name: 'Suspend' })).toBeInTheDocument()
    expect(second.getByText('Showcase: Approved')).toBeInTheDocument()
    expect(second.getByRole('button', { name: 'Remove from showcase' })).toBeInTheDocument()
    expect(second.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument()
    for (const row of [first, second]) expect(row.getByRole('button', { name: 'Resend invite' })).toBeInTheDocument()
  })

  it('approves and removes with the venue id, refetching authoritative approval after each save', async () => {
    mocks.approvals.mockResolvedValueOnce([{ id: 'v1', showcase_approved: false }])
      .mockResolvedValueOnce([{ id: 'v1', showcase_approved: true }])
      .mockResolvedValue([{ id: 'v1', showcase_approved: false }])
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Approve showcase' }))
    expect(mocks.save).toHaveBeenLastCalledWith({ venueId: 'v1', approved: true })
    expect(await screen.findByText('Showcase: Approved')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove from showcase' }))
    expect(mocks.save).toHaveBeenLastCalledWith({ venueId: 'v1', approved: false })
    expect(await screen.findByText('Showcase: Not approved')).toBeInTheDocument()
    expect(mocks.approvals).toHaveBeenCalledTimes(3)
    expect(mocks.venues).toHaveBeenCalledTimes(3)
  })

  it('disables the approval action until its pending save finishes', async () => {
    let finish: () => void = () => {}
    mocks.save.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    mount()
    const button = await screen.findByRole('button', { name: 'Approve showcase' })
    await userEvent.click(button)
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(mocks.save).toHaveBeenCalledTimes(1)
    await act(async () => { finish() })
    await waitFor(() => expect(button).toBeEnabled())
  })

  it.each(['not_platform_admin', 'venue_not_found'])('reports %s without claiming approval and permits retry', async (message) => {
    mocks.save.mockRejectedValueOnce(new Error(message))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Approve showcase' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByText('Showcase: Not approved')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Approve showcase' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2))
  })

  it('does not offer approval while its current value is loading', async () => {
    mocks.approvals.mockReturnValue(new Promise(() => {}))
    mount()
    await screen.findByText(venue.name)
    expect(screen.getByText(/loading showcase/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve showcase|Remove from showcase/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeEnabled()
  })

  it('retries failed approval loading without losing the venue list or its actions', async () => {
    mocks.approvals.mockRejectedValueOnce(new Error('showcase unavailable'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Retry showcase' }))
    expect(await screen.findByRole('button', { name: 'Approve showcase' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Resend invite' })).toBeEnabled()
    expect(mocks.approvals).toHaveBeenCalledTimes(2)
  })

  it('treats a missing approval row as unavailable rather than an unapproved venue', async () => {
    mocks.approvals.mockResolvedValue([])
    mount()
    expect(await screen.findByText(/showcase.*unavailable|unavailable.*showcase/i)).toBeInTheDocument()
    expect(screen.queryByText('Showcase: Not approved')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve showcase|Remove from showcase/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeEnabled()
  })

  it('venue admins cannot see or fetch showcase controls through ConsoleGuard', async () => {
    mocks.admin.mockResolvedValue(false)
    mount(true)
    expect(await screen.findByRole('heading', { name: 'Platform admins only' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve showcase' })).not.toBeInTheDocument()
    expect(mocks.approvals).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
