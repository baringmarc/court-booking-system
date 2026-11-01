// T14.8: the venues list shows every venue with its month numbers and open invoices; suspend and reactivate.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VenueOverview } from './api'

vi.mock('./api', () => ({
  fetchVenuesOverview: vi.fn(), suspendVenue: vi.fn(), reactivateVenue: vi.fn(), fetchIsPlatformAdmin: vi.fn(),
  fetchLeads: vi.fn(), updateLead: vi.fn(),
}))

const { fetchVenuesOverview, suspendVenue, reactivateVenue } = await import('./api')
const { VenuesList } = await import('./VenuesList')

function venue(over: Partial<VenueOverview> = {}): VenueOverview {
  return {
    venue_id: 'v1', slug: 'e2e-alpha', name: 'E2E Alpha Courts', status: 'active',
    month_transactions: 12, month_total: 1234.5, open_invoices: 2, ...over,
  }
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><VenuesList /></QueryClientProvider>)
}

beforeEach(() => {
  vi.mocked(fetchVenuesOverview).mockReset()
  vi.mocked(suspendVenue).mockReset().mockResolvedValue(undefined)
  vi.mocked(reactivateVenue).mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('VenuesList', () => {
  it('shows a loading state while the venues load', () => {
    vi.mocked(fetchVenuesOverview).mockReturnValue(new Promise(() => {}))
    renderList()
    expect(screen.getByText('Loading venues…')).toBeInTheDocument()
  })

  it('shows "No venues yet." when there are none', async () => {
    vi.mocked(fetchVenuesOverview).mockResolvedValue([])
    renderList()
    expect(await screen.findByText('No venues yet.')).toBeInTheDocument()
  })

  it('shows an error with a Retry button that loads again', async () => {
    vi.mocked(fetchVenuesOverview).mockRejectedValueOnce(new Error('boom')).mockResolvedValue([venue()])
    renderList()
    expect(await screen.findByText("Couldn't load venues.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('E2E Alpha Courts')).toBeInTheDocument()
  })

  it('lists each venue with name, slug, status, transactions, PHP total and open invoices', async () => {
    vi.mocked(fetchVenuesOverview).mockResolvedValue([
      venue(),
      venue({ venue_id: 'v2', slug: 'e2e-bravo', name: 'E2E Bravo', status: 'draft', month_transactions: 1, month_total: 0, open_invoices: 0 }),
    ])
    renderList()
    await screen.findByText('E2E Alpha Courts')
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    const first = within(items[0])
    expect(first.getByText('E2E Alpha Courts')).toBeInTheDocument()
    expect(first.getByText(/e2e-alpha/)).toBeInTheDocument()
    expect(first.getByText(/active/i)).toBeInTheDocument()
    expect(first.getByText(/12 transactions/)).toBeInTheDocument()
    expect(first.getByText(/₱\s?1,234\.50/)).toBeInTheDocument()
    expect(first.getByText(/\b2\b.*open invoice|open invoices?\D*\b2\b/i)).toBeInTheDocument()
    const second = within(items[1])
    expect(second.getByText('E2E Bravo')).toBeInTheDocument()
    expect(second.getByText(/draft/i)).toBeInTheDocument()
    expect(second.getByText(/₱\s?0/)).toBeInTheDocument()
  })

  it('shows Suspend on an active venue, Reactivate on a suspended one, and no button on a draft or closed one', async () => {
    vi.mocked(fetchVenuesOverview).mockResolvedValue([
      venue({ venue_id: 'a', name: 'Active One', slug: 'e2e-a', status: 'active' }),
      venue({ venue_id: 's', name: 'Suspended One', slug: 'e2e-s', status: 'suspended' }),
      venue({ venue_id: 'd', name: 'Draft One', slug: 'e2e-d', status: 'draft' }),
      venue({ venue_id: 'c', name: 'Closed One', slug: 'e2e-c', status: 'closed' }),
    ])
    renderList()
    await screen.findByText('Active One')
    const [a, s, d, c] = screen.getAllByRole('listitem').map((li) => within(li))
    expect(a.getByRole('button', { name: /^Suspend/ })).toBeInTheDocument()
    expect(a.queryByRole('button', { name: /^Reactivate/ })).toBeNull()
    expect(s.getByRole('button', { name: /^Reactivate/ })).toBeInTheDocument()
    expect(s.queryByRole('button', { name: /^Suspend/ })).toBeNull()
    expect(d.queryByRole('button')).toBeNull()
    expect(c.queryByRole('button')).toBeNull()
  })

  it('asks for confirmation before suspending and calls suspendVenue with the venue id when confirmed', async () => {
    vi.mocked(fetchVenuesOverview).mockResolvedValue([venue()])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderList()
    await screen.findByText('E2E Alpha Courts')
    await userEvent.click(screen.getByRole('button', { name: /^Suspend/ }))
    expect(confirm).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(suspendVenue).toHaveBeenCalledWith('v1'))
  })

  it('does not suspend when the confirmation is declined', async () => {
    vi.mocked(fetchVenuesOverview).mockResolvedValue([venue()])
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderList()
    await screen.findByText('E2E Alpha Courts')
    await userEvent.click(screen.getByRole('button', { name: /^Suspend/ }))
    expect(suspendVenue).not.toHaveBeenCalled()
  })

  it('reactivates a suspended venue with its id', async () => {
    vi.mocked(fetchVenuesOverview).mockResolvedValue([venue({ status: 'suspended' })])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderList()
    await screen.findByText('E2E Alpha Courts')
    await userEvent.click(screen.getByRole('button', { name: /^Reactivate/ }))
    await vi.waitFor(() => expect(reactivateVenue).toHaveBeenCalledWith('v1'))
  })

  it('reloads the overview after a suspend succeeds', async () => {
    vi.mocked(fetchVenuesOverview).mockResolvedValueOnce([venue()]).mockResolvedValue([venue({ status: 'suspended' })])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderList()
    await screen.findByText('E2E Alpha Courts')
    await userEvent.click(screen.getByRole('button', { name: /^Suspend/ }))
    expect(await screen.findByRole('button', { name: /^Reactivate/ })).toBeInTheDocument()
    expect(fetchVenuesOverview).toHaveBeenCalledTimes(2)
  })

  it('shows the failure message in an alert when suspending fails', async () => {
    vi.mocked(fetchVenuesOverview).mockResolvedValue([venue()])
    vi.mocked(suspendVenue).mockRejectedValue(new Error('not_active'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderList()
    await screen.findByText('E2E Alpha Courts')
    await userEvent.click(screen.getByRole('button', { name: /^Suspend/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not_active')
  })

  it('shows the failure message in an alert when reactivating fails', async () => {
    vi.mocked(fetchVenuesOverview).mockResolvedValue([venue({ status: 'suspended' })])
    vi.mocked(reactivateVenue).mockRejectedValue(new Error('not_suspended'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderList()
    await screen.findByText('E2E Alpha Courts')
    await userEvent.click(screen.getByRole('button', { name: /^Reactivate/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not_suspended')
  })
})
