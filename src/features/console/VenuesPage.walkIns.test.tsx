// T18.4: the console's venue panel switches a venue's walk-ins on and off, saving immediately in both directions.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import type { VenueOverview, WalkInsRow } from './api'

const mocks = vi.hoisted(() => ({
  rows: vi.fn<() => Promise<WalkInsRow[]>>(),
  save: vi.fn<(input: { venueId: string; enabled: boolean }) => Promise<void>>(),
  payments: vi.fn(),
  approvals: vi.fn(),
  venues: vi.fn(),
  admin: vi.fn<() => Promise<boolean>>(),
}))
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  fetchWalkIns: mocks.rows, setWalkIns: mocks.save,
  fetchOnlinePayments: mocks.payments,
  fetchShowcaseApprovals: mocks.approvals,
  fetchVenuesPage: mocks.venues, fetchIsPlatformAdmin: mocks.admin,
}))

const { ConsoleApp } = await import('./ConsoleApp')

const venue: VenueOverview = {
  venue_id: 'v1', slug: 'e2e-walk', name: 'E2E Walk Courts', status: 'active',
  month_transactions: 2, month_total: 20, open_invoices: 1,
}

function mount(path = '/venues?open=v1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><AuthContext.Provider value={authState('admin')}>
    <MemoryRouter initialEntries={[path]}><ConsoleApp /></MemoryRouter>
  </AuthContext.Provider></QueryClientProvider>)
}

beforeEach(() => {
  mocks.venues.mockReset().mockResolvedValue({ rows: [venue], total: 1 })
  mocks.approvals.mockReset().mockResolvedValue([{ id: 'v1', showcase_approved: false }])
  mocks.payments.mockReset().mockResolvedValue([{ venue_id: 'v1', online_payments_enabled: false }])
  mocks.rows.mockReset().mockResolvedValue([{ venue_id: 'v1', walk_ins_enabled: false }])
  mocks.save.mockReset().mockResolvedValue(undefined)
  mocks.admin.mockReset().mockResolvedValue(true)
})

describe('T18.4 walk-ins control in the venue panel', () => {
  it('shows Off with a Turn on button, and On with a Turn off button', async () => {
    mount()
    expect(await screen.findByText('Walk-ins: Off')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn on walk-ins' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Turn off walk-ins' })).not.toBeInTheDocument()
  })

  it('shows the state of the open venue, not another venue', async () => {
    mocks.rows.mockResolvedValue([{ venue_id: 'v2', walk_ins_enabled: false }, { venue_id: 'v1', walk_ins_enabled: true }])
    mount()
    expect(await screen.findByText('Walk-ins: On')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn off walk-ins' })).toBeInTheDocument()
  })

  it('announces the state politely', async () => {
    mount()
    expect(await screen.findByText('Walk-ins: Off')).toHaveAttribute('aria-live', 'polite')
  })

  it('turning on saves immediately with no confirmation dialog', async () => {
    mocks.rows.mockResolvedValueOnce([{ venue_id: 'v1', walk_ins_enabled: false }])
      .mockResolvedValue([{ venue_id: 'v1', walk_ins_enabled: true }])
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on walk-ins' }))
    expect(screen.queryByRole('dialog', { name: /walk-ins/i })).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ venueId: 'v1', enabled: true }))
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Walk-ins: On')).toBeInTheDocument()
    expect(mocks.venues).toHaveBeenCalledTimes(2)
  })

  it('turning off saves immediately with no dialog', async () => {
    mocks.rows.mockResolvedValueOnce([{ venue_id: 'v1', walk_ins_enabled: true }])
      .mockResolvedValue([{ venue_id: 'v1', walk_ins_enabled: false }])
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off walk-ins' }))
    expect(screen.queryByRole('dialog', { name: /walk-ins/i })).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ venueId: 'v1', enabled: false }))
    expect(await screen.findByText('Walk-ins: Off')).toBeInTheDocument()
  })

  it('disables the button and says Saving while a save is pending', async () => {
    mocks.rows.mockResolvedValue([{ venue_id: 'v1', walk_ins_enabled: true }])
    let finish: () => void = () => {}
    mocks.save.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    mount()
    const button = await screen.findByRole('button', { name: 'Turn off walk-ins' })
    await userEvent.click(button)
    expect(screen.getByText('Saving walk-ins…')).toHaveAttribute('role', 'status')
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(mocks.save).toHaveBeenCalledTimes(1)
    await act(async () => { finish() })
    await waitFor(() => expect(button).toBeEnabled())
  })

  it('shows the error message when saving fails and keeps the state unchanged', async () => {
    mocks.save.mockRejectedValueOnce(new Error('not_platform_admin'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on walk-ins' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not_platform_admin')
    expect(screen.getByText('Walk-ins: Off')).toBeInTheDocument()
  })

  it('shows loading text while the switch is being read', async () => {
    mocks.rows.mockReturnValue(new Promise(() => {}))
    mount()
    expect(await screen.findByText('Loading walk-ins…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Turn (on|off) walk-ins/ })).not.toBeInTheDocument()
  })

  it('retries a failed read without losing the panel', async () => {
    mocks.rows.mockRejectedValueOnce(new Error('read failed'))
    mount()
    expect(await screen.findByText('Walk-ins unavailable.')).toHaveAttribute('role', 'alert')
    await userEvent.click(screen.getByRole('button', { name: 'Retry walk-ins' }))
    expect(await screen.findByText('Walk-ins: Off')).toBeInTheDocument()
    expect(mocks.rows).toHaveBeenCalledTimes(2)
  })

  it('treats a missing row as unavailable, not Off', async () => {
    mocks.rows.mockResolvedValue([])
    mount()
    expect(await screen.findByText('Walk-ins unavailable.')).toBeInTheDocument()
    expect(screen.queryByText('Walk-ins: Off')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Turn (on|off) walk-ins/ })).not.toBeInTheDocument()
  })

  it('venue admins never reach the control', async () => {
    mocks.admin.mockResolvedValue(false)
    mount()
    expect(await screen.findByRole('heading', { name: 'Platform admins only' })).toBeInTheDocument()
    expect(mocks.rows).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
