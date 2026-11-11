// T18.2: the console's venue panel switches a venue's online payments, with a confirmation before turning on.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import type { OnlinePaymentsRow, VenueOverview } from './api'

const mocks = vi.hoisted(() => ({
  rows: vi.fn<() => Promise<OnlinePaymentsRow[]>>(),
  save: vi.fn<(input: { venueId: string; enabled: boolean }) => Promise<void>>(),
  approvals: vi.fn(),
  venues: vi.fn(),
  admin: vi.fn<() => Promise<boolean>>(),
}))
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  fetchOnlinePayments: mocks.rows, setOnlinePayments: mocks.save,
  // T18.4: the panel also reads the walk-ins switch.
  fetchWalkIns: async () => [{ venue_id: 'v1', walk_ins_enabled: false }],
  fetchShowcaseApprovals: mocks.approvals,
  fetchVenuesPage: mocks.venues, fetchIsPlatformAdmin: mocks.admin,
}))

const { ConsoleApp } = await import('./ConsoleApp')

const venue: VenueOverview = {
  venue_id: 'v1', slug: 'e2e-pay', name: 'E2E Pay Courts', status: 'active',
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
  mocks.rows.mockReset().mockResolvedValue([{ venue_id: 'v1', online_payments_enabled: false }])
  mocks.save.mockReset().mockResolvedValue(undefined)
  mocks.admin.mockReset().mockResolvedValue(true)
})

describe('T18.2 online payments control in the venue panel', () => {
  it('shows Off with a Turn on button, and On with a Turn off button', async () => {
    mount()
    expect(await screen.findByText('Online payments: Off')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn on online payments' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Turn off online payments' })).not.toBeInTheDocument()
  })

  it('shows the state of the open venue, not another venue', async () => {
    mocks.rows.mockResolvedValue([{ venue_id: 'v2', online_payments_enabled: false }, { venue_id: 'v1', online_payments_enabled: true }])
    mount()
    expect(await screen.findByText('Online payments: On')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn off online payments' })).toBeInTheDocument()
  })

  it('turning on asks first, naming the PayMongo test-mode account, and only Turn on saves', async () => {
    mocks.rows.mockResolvedValueOnce([{ venue_id: 'v1', online_payments_enabled: false }])
      .mockResolvedValue([{ venue_id: 'v1', online_payments_enabled: true }])
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on online payments' }))
    const dialog = await screen.findByRole('dialog', { name: 'Turn on online payments?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveTextContent('PayMongo test-mode account')
    expect(mocks.save).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn on' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ venueId: 'v1', enabled: true }))
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Online payments: On')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Turn on online payments?' })).not.toBeInTheDocument()
    expect(mocks.venues).toHaveBeenCalledTimes(2)
  })

  it('Cancel closes the confirmation without saving', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on online payments' }))
    const dialog = await screen.findByRole('dialog', { name: 'Turn on online payments?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Turn on online payments?' })).not.toBeInTheDocument()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(screen.getByText('Online payments: Off')).toBeInTheDocument()
  })

  it('Escape cancels the confirmation without saving', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on online payments' }))
    const dialog = await screen.findByRole('dialog', { name: 'Turn on online payments?' })
    await userEvent.type(dialog, '{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Turn on online payments?' })).not.toBeInTheDocument()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('turning off saves immediately with no dialog', async () => {
    mocks.rows.mockResolvedValueOnce([{ venue_id: 'v1', online_payments_enabled: true }])
      .mockResolvedValue([{ venue_id: 'v1', online_payments_enabled: false }])
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off online payments' }))
    expect(screen.queryByRole('dialog', { name: 'Turn on online payments?' })).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ venueId: 'v1', enabled: false }))
    expect(await screen.findByText('Online payments: Off')).toBeInTheDocument()
  })

  it('disables the button and says Saving while a save is pending', async () => {
    mocks.rows.mockResolvedValue([{ venue_id: 'v1', online_payments_enabled: true }])
    let finish: () => void = () => {}
    mocks.save.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    mount()
    const button = await screen.findByRole('button', { name: 'Turn off online payments' })
    await userEvent.click(button)
    expect(screen.getByText('Saving online payments…')).toHaveAttribute('role', 'status')
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(mocks.save).toHaveBeenCalledTimes(1)
    await act(async () => { finish() })
    await waitFor(() => expect(button).toBeEnabled())
  })

  it('shows the error message when saving fails and keeps the state unchanged', async () => {
    mocks.save.mockRejectedValueOnce(new Error('not_platform_admin'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on online payments' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Turn on online payments?' })).getByRole('button', { name: 'Turn on' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not_platform_admin')
    expect(screen.getByText('Online payments: Off')).toBeInTheDocument()
  })

  it('shows loading text while the switch is being read', async () => {
    mocks.rows.mockReturnValue(new Promise(() => {}))
    mount()
    expect(await screen.findByText('Loading online payments…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Turn (on|off) online payments/ })).not.toBeInTheDocument()
  })

  it('retries a failed read without losing the panel', async () => {
    mocks.rows.mockRejectedValueOnce(new Error('read failed'))
    mount()
    expect(await screen.findByText('Online payments unavailable.')).toHaveAttribute('role', 'alert')
    await userEvent.click(screen.getByRole('button', { name: 'Retry online payments' }))
    expect(await screen.findByText('Online payments: Off')).toBeInTheDocument()
    expect(mocks.rows).toHaveBeenCalledTimes(2)
  })

  it('treats a missing row as unavailable, not Off', async () => {
    mocks.rows.mockResolvedValue([])
    mount()
    expect(await screen.findByText('Online payments unavailable.')).toBeInTheDocument()
    expect(screen.queryByText('Online payments: Off')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Turn (on|off) online payments/ })).not.toBeInTheDocument()
  })

  it('venue admins never reach the control', async () => {
    mocks.admin.mockResolvedValue(false)
    mount()
    expect(await screen.findByRole('heading', { name: 'Platform admins only' })).toBeInTheDocument()
    expect(mocks.rows).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
