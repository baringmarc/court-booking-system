// T24.2: a venue's detail panel invites staff, independently of the owner resend form.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import type { VenueOverview } from './api'

const mocks = vi.hoisted(() => ({
  admin: vi.fn<() => Promise<boolean>>(), venues: vi.fn(), staff: vi.fn(), resend: vi.fn(), approvals: vi.fn(),
}))
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  fetchIsPlatformAdmin: mocks.admin, fetchVenuesPage: mocks.venues, inviteVenueStaff: mocks.staff,
  resendOwnerInvite: mocks.resend, fetchShowcaseApprovals: mocks.approvals,
  fetchOnlinePayments: async () => [{ venue_id: 'v1', online_payments_enabled: false }],
  fetchWalkIns: async () => [{ venue_id: 'v1', walk_ins_enabled: false }],
}))

const { ConsoleApp } = await import('./ConsoleApp')

const venue: VenueOverview = {
  venue_id: 'v1', slug: 'e2e-alpha', name: 'E2E Alpha Courts', status: 'draft',
  month_transactions: 0, month_total: 0, open_invoices: 0,
}

async function openPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><AuthContext.Provider value={authState('admin')}>
    <MemoryRouter initialEntries={['/venues?open=v1']}><ConsoleApp /></MemoryRouter>
  </AuthContext.Provider></QueryClientProvider>)
  return waitFor(() => {
    const el = screen.queryByRole('dialog', { name: /E2E Alpha Courts/ }) ?? screen.queryByRole('region', { name: /E2E Alpha Courts/ })
    expect(el).not.toBeNull()
    return el as HTMLElement
  })
}

async function openForm() {
  const panel = await openPanel()
  await userEvent.click(within(panel).getByRole('button', { name: 'Invite staff' }))
  return panel
}

beforeEach(() => {
  mocks.admin.mockReset().mockResolvedValue(true)
  mocks.venues.mockReset().mockResolvedValue({ rows: [venue], total: 1 })
  mocks.approvals.mockReset().mockResolvedValue([{ id: 'v1', showcase_approved: false }])
  mocks.staff.mockReset()
  mocks.resend.mockReset()
})

describe('Venue detail invite staff (T24.2)', () => {
  it('is offered for a draft venue and the button opens the form', async () => {
    const panel = await openPanel()
    expect(within(panel).queryByLabelText('Staff email')).toBeNull()
    await userEvent.click(within(panel).getByRole('button', { name: 'Invite staff' }))
    const field = within(panel).getByLabelText('Staff email')
    expect(field).toHaveAttribute('type', 'email')
    expect(field).toBeRequired()
    expect(within(panel).getByRole('button', { name: 'Send staff invite' })).toBeInTheDocument()
  })

  it('does not call the function for an empty email', async () => {
    const panel = await openForm()
    await userEvent.click(within(panel).getByRole('button', { name: 'Send staff invite' }))
    expect(mocks.staff).not.toHaveBeenCalled()
  })

  it('does not call the function for an invalid email', async () => {
    const panel = await openForm()
    await userEvent.type(within(panel).getByLabelText('Staff email'), 'not-an-email')
    await userEvent.click(within(panel).getByRole('button', { name: 'Send staff invite' }))
    expect(mocks.staff).not.toHaveBeenCalled()
  })

  it.each([
    ['invite', 'An account setup invitation'],
    ['link', 'A fresh access link'],
    ['welcome', 'A welcome email with the sign-in link'],
  ] as const)('sends the venue and email and reports %s', async (sent, lead) => {
    mocks.staff.mockResolvedValue({ sent })
    const panel = await openForm()
    await userEvent.type(within(panel).getByLabelText('Staff email'), 'staff@example.com')
    await userEvent.click(within(panel).getByRole('button', { name: 'Send staff invite' }))
    expect(mocks.staff).toHaveBeenCalledWith({ venueId: 'v1', email: 'staff@example.com' })
    expect(await within(panel).findByRole('status')).toHaveTextContent(`${lead} is on its way to staff@example.com.`)
    expect(mocks.resend).not.toHaveBeenCalled()
  })

  it('disables the submit button while sending', async () => {
    mocks.staff.mockReturnValue(new Promise(() => {}))
    const panel = await openForm()
    await userEvent.type(within(panel).getByLabelText('Staff email'), 'staff@example.com')
    await userEvent.click(within(panel).getByRole('button', { name: 'Send staff invite' }))
    await waitFor(() => expect(within(panel).getByRole('button', { name: /staff invite|sending/i })).toBeDisabled())
  })

  it('shows the error when sending fails', async () => {
    mocks.staff.mockRejectedValue(new Error('That email belongs to a customer.'))
    const panel = await openForm()
    await userEvent.type(within(panel).getByLabelText('Staff email'), 'staff@example.com')
    await userEvent.click(within(panel).getByRole('button', { name: 'Send staff invite' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('That email belongs to a customer.')
  })

  it('keeps the owner form independent of the staff form', async () => {
    const panel = await openForm()
    await userEvent.click(within(panel).getByRole('button', { name: 'Resend invite' }))
    expect(within(panel).getByLabelText('Owner email')).toBeInTheDocument()
    expect(within(panel).getByLabelText('Staff email')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Send invite' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Send staff invite' })).toBeInTheDocument()
  })
})
