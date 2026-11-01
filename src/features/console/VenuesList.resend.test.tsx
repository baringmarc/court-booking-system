// T14.5d: a venue's owner can be sent a fresh invite or sign-in link from the venues list.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VenueOverview } from './api'

vi.mock('./api', () => ({
  fetchVenuesOverview: vi.fn(), suspendVenue: vi.fn(), reactivateVenue: vi.fn(), fetchIsPlatformAdmin: vi.fn(),
  fetchLeads: vi.fn(), updateLead: vi.fn(), resendOwnerInvite: vi.fn(),
}))

const { fetchVenuesOverview, resendOwnerInvite } = await import('./api')
const { VenuesList } = await import('./VenuesList')

const venue: VenueOverview = {
  venue_id: 'v1', slug: 'e2e-alpha', name: 'E2E Alpha Courts', status: 'draft',
  month_transactions: 0, month_total: 0, open_invoices: 0,
}

async function openForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><VenuesList /></QueryClientProvider>)
  const item = (await screen.findByText('E2E Alpha Courts')).closest('li')!
  await userEvent.click(within(item).getByRole('button', { name: 'Resend invite' }))
  await userEvent.type(within(item).getByLabelText('Owner email'), 'owner@example.com')
  return item
}

beforeEach(() => {
  vi.mocked(fetchVenuesOverview).mockReset().mockResolvedValue([venue])
  vi.mocked(resendOwnerInvite).mockReset()
})

describe('VenuesList resend invite (T14.5d)', () => {
  it('is offered for a draft venue too', async () => {
    vi.mocked(fetchVenuesOverview).mockResolvedValue([venue])
    await openForm()
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeInTheDocument()
  })

  it('sends the venue and the typed email, and says a sign-in link is on its way', async () => {
    vi.mocked(resendOwnerInvite).mockResolvedValue({ sent: 'link' })
    const item = await openForm()
    await userEvent.click(within(item).getByRole('button', { name: 'Send invite' }))
    expect(resendOwnerInvite).toHaveBeenCalledWith({ venueId: 'v1', email: 'owner@example.com' })
    expect(await within(item).findByRole('status')).toHaveTextContent('sign-in link is on its way to owner@example.com')
  })

  it('says a new invite is on its way for an email with no account', async () => {
    vi.mocked(resendOwnerInvite).mockResolvedValue({ sent: 'invite' })
    const item = await openForm()
    await userEvent.click(within(item).getByRole('button', { name: 'Send invite' }))
    expect(await within(item).findByRole('status')).toHaveTextContent('new invite is on its way')
  })

  it('tells the admin when the owner already has a password and where they sign in', async () => {
    vi.mocked(resendOwnerInvite).mockResolvedValue({ sent: 'none' })
    const item = await openForm()
    await userEvent.click(within(item).getByRole('button', { name: 'Send invite' }))
    expect(await within(item).findByRole('status')).toHaveTextContent('already has a password')
    expect(within(item).getByRole('status')).toHaveTextContent('e2e-alpha.plotline.fit/admin/login')
  })

  it('clears the status when the email is edited, so it never names an address that was not sent', async () => {
    vi.mocked(resendOwnerInvite).mockResolvedValue({ sent: 'link' })
    const item = await openForm()
    await userEvent.click(within(item).getByRole('button', { name: 'Send invite' }))
    expect(await within(item).findByRole('status')).toBeInTheDocument()
    await userEvent.type(within(item).getByLabelText('Owner email'), 'x')
    expect(within(item).queryByRole('status')).toBeNull()
  })

  it('shows the error when sending fails', async () => {
    vi.mocked(resendOwnerInvite).mockRejectedValue(new Error("We couldn't send the email."))
    const item = await openForm()
    await userEvent.click(within(item).getByRole('button', { name: 'Send invite' }))
    expect(await within(item).findByRole('alert')).toHaveTextContent("We couldn't send the email.")
  })
})
