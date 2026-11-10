// T17.28: closing the delete dialog while file cleanup is still pending says so on the page and closes the panel.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import type { VenueOverview } from './api'

const mocks = vi.hoisted(() => ({
  venues: vi.fn<() => Promise<unknown>>(),
  remove: vi.fn<() => Promise<unknown>>(),
}))
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  fetchIsPlatformAdmin: async () => true,
  fetchVenuesPage: mocks.venues,
  fetchShowcaseApprovals: async () => [],
  // T18.2, T18.4: the panel also reads the online payments and walk-ins switches.
  fetchOnlinePayments: async () => [{ venue_id: 'v1', online_payments_enabled: false }],
  fetchWalkIns: async () => [{ venue_id: 'v1', walk_ins_enabled: false }],
  fetchVenueDeletionPreview: async () => ({
    slug: 'e2e-alpha', deletable: true, blockers: [],
    counts: { bookings: 0, payments: 0, checkouts: 0, charges: 0, invoices: 0, open_play_sessions: 0, courts: 1, members: 1 },
  }),
  deleteUnusedVenue: mocks.remove,
  retryVenueFileCleanup: vi.fn(),
}))

const { ConsoleApp } = await import('./ConsoleApp')

const venue: VenueOverview = { venue_id: 'v1', slug: 'e2e-alpha', name: 'E2E Alpha Courts', status: 'draft', month_transactions: 0, month_total: 0, open_invoices: 0 }

function Probe() {
  const location = useLocation()
  return <div data-testid="location">{location.search}</div>
}

beforeEach(() => {
  let gone = false
  mocks.venues.mockReset().mockImplementation(async () => (gone ? { rows: [], total: 0 } : { rows: [venue], total: 1 }))
  mocks.remove.mockReset().mockImplementation(async () => { gone = true; return { cleanup: 'pending' } })
})

it('Close while cleanup is pending reports the deletion and the pending cleanup, and clears the panel', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}><AuthContext.Provider value={authState('admin')}>
      <MemoryRouter initialEntries={['/venues?open=v1']}><ConsoleApp /><Probe /></MemoryRouter>
    </AuthContext.Provider></QueryClientProvider>,
  )
  await userEvent.click(within(await screen.findByRole('region', { name: 'Venue: E2E Alpha Courts' })).getByRole('button', { name: 'Delete venue' }))
  const dialog = await screen.findByRole('dialog', { name: 'Delete E2E Alpha Courts?' })
  await userEvent.type(await within(dialog).findByRole('textbox', { name: 'Type the subdomain to confirm' }), 'e2e-alpha')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete venue' }))
  await userEvent.click(await within(dialog).findByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(await screen.findByRole('status')).toHaveTextContent(/E2E Alpha Courts was deleted\. Its file cleanup is still pending/)
  await waitFor(() => expect(screen.getByTestId('location').textContent).not.toContain('open='))
})
