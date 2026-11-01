// T14.6: the inbox offers "Create venue" on open leads only.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Lead } from './api'

vi.mock('./api', () => ({
  fetchLeads: vi.fn(), updateLead: vi.fn(), fetchIsPlatformAdmin: vi.fn(),
  createVenue: vi.fn(), inviteVenueOwner: vi.fn(),
}))

const { fetchLeads } = await import('./api')
const { LeadsInbox } = await import('./LeadsInbox')

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'l1', first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com', phone: '0917 000 0001',
    venue_name: 'E2E Padel Club', location: 'Cebu', courts: 4, facebook: null, message: null,
    status: 'new', notes: null, consented_at: '2030-01-01T00:00:00Z',
    created_at: '2030-01-02T00:00:00Z', updated_at: '2030-01-02T00:00:00Z', ...over,
  }
}

beforeEach(() => vi.mocked(fetchLeads).mockReset())

function renderInbox() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><LeadsInbox /></QueryClientProvider>)
}

describe('LeadsInbox create venue', () => {
  it('shows "Create venue" on new and talking leads only', async () => {
    vi.mocked(fetchLeads).mockResolvedValue([
      lead({ id: 'a', venue_name: 'Alpha', status: 'new' }),
      lead({ id: 'b', venue_name: 'Bravo', status: 'talking' }),
      lead({ id: 'c', venue_name: 'Charlie', status: 'won' }),
      lead({ id: 'd', venue_name: 'Delta', status: 'lost' }),
    ])
    renderInbox()
    await screen.findByText('Alpha')
    const items = screen.getAllByRole('listitem')
    expect(within(items[0]).getByRole('button', { name: 'Create venue' })).toBeInTheDocument()
    expect(within(items[1]).getByRole('button', { name: 'Create venue' })).toBeInTheDocument()
    expect(within(items[2]).queryByRole('button', { name: 'Create venue' })).toBeNull()
    expect(within(items[3]).queryByRole('button', { name: 'Create venue' })).toBeNull()
  })

  it('clicking it opens the form seeded for that lead inside that item', async () => {
    vi.mocked(fetchLeads).mockResolvedValue([
      lead({ id: 'a', venue_name: 'Alpha Club', email: 'a@example.com' }),
      lead({ id: 'b', venue_name: 'Bravo Club', email: 'b@example.com' }),
    ])
    renderInbox()
    await screen.findByText('Alpha Club')
    const items = screen.getAllByRole('listitem')
    await userEvent.click(within(items[1]).getByRole('button', { name: 'Create venue' }))
    expect(within(items[1]).getByLabelText('Venue name')).toHaveValue('Bravo Club')
    expect(within(items[1]).getByLabelText('Owner email')).toHaveValue('b@example.com')
    expect(within(items[0]).queryByLabelText('Venue name')).toBeNull()
  })
})
