// T14.5d migrated for T17.19: a venue's owner can be sent a fresh invite or sign-in link from the venue's detail panel.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import type { VenueOverview } from './api'

const mocks = vi.hoisted(() => ({
  admin: vi.fn<() => Promise<boolean>>(), venues: vi.fn(), resend: vi.fn(), approvals: vi.fn(),
}))
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  fetchIsPlatformAdmin: mocks.admin, fetchVenuesPage: mocks.venues, resendOwnerInvite: mocks.resend, fetchShowcaseApprovals: mocks.approvals,
}))

const { ConsoleApp } = await import('./ConsoleApp')

const venue: VenueOverview = {
  venue_id: 'v1', slug: 'e2e-alpha', name: 'E2E Alpha Courts', status: 'draft',
  month_transactions: 0, month_total: 0, open_invoices: 0,
}

async function openForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><AuthContext.Provider value={authState('admin')}>
    <MemoryRouter initialEntries={['/venues?open=v1']}><ConsoleApp /></MemoryRouter>
  </AuthContext.Provider></QueryClientProvider>)
  const panel = await waitFor(() => {
    const el = screen.queryByRole('dialog', { name: /E2E Alpha Courts/ }) ?? screen.queryByRole('region', { name: /E2E Alpha Courts/ })
    expect(el).not.toBeNull()
    return el as HTMLElement
  })
  await userEvent.click(within(panel).getByRole('button', { name: 'Resend invite' }))
  await userEvent.type(within(panel).getByLabelText('Owner email'), 'owner@example.com')
  return panel
}

beforeEach(() => {
  mocks.admin.mockReset().mockResolvedValue(true)
  mocks.venues.mockReset().mockResolvedValue({ rows: [venue], total: 1 })
  mocks.approvals.mockReset().mockResolvedValue([{ id: 'v1', showcase_approved: false }])
  mocks.resend.mockReset()
})

describe('Venue detail resend invite (T14.5d)', () => {
  it('is offered for a draft venue too', async () => {
    await openForm()
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeInTheDocument()
  })

  it('sends the venue and the typed email, and says a sign-in link is on its way', async () => {
    mocks.resend.mockResolvedValue({ sent: 'link' })
    const panel = await openForm()
    await userEvent.click(within(panel).getByRole('button', { name: 'Send invite' }))
    expect(mocks.resend).toHaveBeenCalledWith({ venueId: 'v1', email: 'owner@example.com' })
    expect(await within(panel).findByRole('status')).toHaveTextContent('sign-in link is on its way to owner@example.com')
  })

  it('says a new invite is on its way for an email with no account', async () => {
    mocks.resend.mockResolvedValue({ sent: 'invite' })
    const panel = await openForm()
    await userEvent.click(within(panel).getByRole('button', { name: 'Send invite' }))
    expect(await within(panel).findByRole('status')).toHaveTextContent('new invite is on its way')
  })

  it('tells the admin when the owner already has a password and where they sign in', async () => {
    mocks.resend.mockResolvedValue({ sent: 'none' })
    const panel = await openForm()
    await userEvent.click(within(panel).getByRole('button', { name: 'Send invite' }))
    expect(await within(panel).findByRole('status')).toHaveTextContent('already has a password')
    expect(within(panel).getByRole('status')).toHaveTextContent('e2e-alpha.plotline.fit/admin/login')
  })

  it('clears the status when the email is edited, so it never names an address that was not sent', async () => {
    mocks.resend.mockResolvedValue({ sent: 'link' })
    const panel = await openForm()
    await userEvent.click(within(panel).getByRole('button', { name: 'Send invite' }))
    expect(await within(panel).findByRole('status')).toBeInTheDocument()
    await userEvent.type(within(panel).getByLabelText('Owner email'), 'x')
    expect(within(panel).queryByRole('status')).toBeNull()
  })

  it('shows the error when sending fails', async () => {
    mocks.resend.mockRejectedValue(new Error("We couldn't send the email."))
    const panel = await openForm()
    await userEvent.click(within(panel).getByRole('button', { name: 'Send invite' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent("We couldn't send the email.")
  })
})
