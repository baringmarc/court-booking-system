// T17.19: the routed Venues page. Migrates VenuesList.test.tsx and adds paging, URL state and the detail panel.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import type { Page, VenueOverview } from './api'

const mocks = vi.hoisted(() => ({
  admin: vi.fn<() => Promise<boolean>>(),
  venues: vi.fn<(input: { search: string; status: string; page: number }) => Promise<unknown>>(),
  suspend: vi.fn<(id: string) => Promise<void>>(),
  reactivate: vi.fn<(id: string) => Promise<void>>(),
  approvals: vi.fn(),
}))
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  fetchIsPlatformAdmin: mocks.admin, fetchVenuesPage: mocks.venues, suspendVenue: mocks.suspend,
  reactivateVenue: mocks.reactivate, fetchShowcaseApprovals: mocks.approvals,
  // T18.2: the panel also reads the online payments switch.
  fetchOnlinePayments: async () => [{ venue_id: 'v1', online_payments_enabled: false }],
}))

const { ConsoleApp } = await import('./ConsoleApp')

function venue(over: Partial<VenueOverview> = {}): VenueOverview {
  return {
    venue_id: 'v1', slug: 'e2e-alpha', name: 'E2E Alpha Courts', status: 'active',
    month_transactions: 12, month_total: 1234.5, open_invoices: 2, ...over,
  }
}
const pad = (n: number) => String(n).padStart(3, '0')
function manyVenues(count: number): VenueOverview[] {
  return Array.from({ length: count }, (_, i) => venue({
    venue_id: `v${pad(i + 1)}`, slug: `e2e-venue-${pad(i + 1)}`, name: `E2E Venue ${pad(i + 1)}`, status: (i + 1) % 2 === 0 ? 'draft' : 'active',
  }))
}
function servePages(all: VenueOverview[]) {
  mocks.venues.mockImplementation(async ({ status, search, page }) => {
    const rows = all.filter((v) => (status === '' || v.status === status) && v.name.toLowerCase().includes(search.toLowerCase()))
    return { rows: rows.slice((page - 1) * 25, page * 25), total: rows.length } satisfies Page<VenueOverview>
  })
}

function Probe() {
  const location = useLocation()
  const navigate = useNavigate()
  return <div><div data-testid="location">{location.pathname + location.search}</div><button type="button" onClick={() => void navigate(-1)}>history back</button></div>
}
function renderAt(path = '/venues') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}><AuthContext.Provider value={authState('admin')}>
      <MemoryRouter initialEntries={[path]}><ConsoleApp /><Probe /></MemoryRouter>
    </AuthContext.Provider></QueryClientProvider>,
  )
}
const params = () => new URL(screen.getByTestId('location').textContent ?? '', 'http://x').searchParams
const names = () => screen.queryAllByText(/^E2E Venue \d{3}$/).map((e) => e.textContent)
function detailsFor(name: string) { return screen.getByRole('button', { name: new RegExp(`^(?=.*details)(?=.*${name})`, 'i') }) }
async function panelFor(name: string) {
  const re = new RegExp(name, 'i')
  return waitFor(() => {
    const el = screen.queryByRole('dialog', { name: re }) ?? screen.queryByRole('region', { name: re })
    expect(el).not.toBeNull()
    return el as HTMLElement
  })
}

beforeEach(() => {
  mocks.admin.mockReset().mockResolvedValue(true)
  mocks.venues.mockReset()
  mocks.suspend.mockReset().mockResolvedValue(undefined)
  mocks.reactivate.mockReset().mockResolvedValue(undefined)
  mocks.approvals.mockReset().mockResolvedValue([{ id: 'v1', showcase_approved: false }])
})
afterEach(() => { vi.restoreAllMocks() })

describe('Venues page states (was VenuesList)', () => {
  it('shows a loading state while the venues load', async () => {
    mocks.venues.mockReturnValue(new Promise(() => {}))
    renderAt()
    expect(await screen.findByText('Loading venues…')).toBeInTheDocument()
  })

  it('shows "No venues yet." when there are none', async () => {
    mocks.venues.mockResolvedValue({ rows: [], total: 0 })
    renderAt()
    expect(await screen.findByText('No venues yet.')).toBeInTheDocument()
  })

  it('shows a filtered-empty message (not "No venues yet.") when the filters match nothing', async () => {
    servePages(manyVenues(3))
    renderAt('/venues?q=zzz')
    expect(await screen.findByText(/no venues/i)).toBeInTheDocument()
    expect(screen.queryByText('No venues yet.')).not.toBeInTheDocument()
  })

  it('shows an error with a Retry button that loads again', async () => {
    mocks.venues.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ rows: [venue()], total: 1 })
    renderAt()
    expect(await screen.findByText("Couldn't load venues.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('E2E Alpha Courts')).toBeInTheDocument()
  })
})

describe('Venues rows and detail panel', () => {
  it('lists compact rows with name, slug and status; the month numbers show on the page; no actions in the list', async () => {
    mocks.venues.mockResolvedValue({ rows: [venue(), venue({ venue_id: 'v2', slug: 'e2e-bravo', name: 'E2E Bravo', status: 'draft', month_transactions: 1, month_total: 0, open_invoices: 0 })], total: 2 })
    renderAt()
    const first = (await screen.findByText('E2E Alpha Courts')).closest('li')!
    expect(within(first).getByText(/e2e-alpha/)).toBeInTheDocument()
    expect(within(first).getByText(/active/i)).toBeInTheDocument()
    const second = screen.getByText('E2E Bravo').closest('li')!
    expect(within(second).getByText(/draft/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Suspend/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resend invite' })).not.toBeInTheDocument()
    await userEvent.click(detailsFor('E2E Alpha Courts'))
    const panel = await panelFor('E2E Alpha Courts')
    expect(params().get('open')).toBe('v1')
    expect(within(panel).getByText(/12 transactions/)).toBeInTheDocument()
    expect(within(panel).getByText(/₱\s?1,234\.50/)).toBeInTheDocument()
    expect(within(panel).getByText(/\b2\b.*open invoice|open invoices?\D*\b2\b/i)).toBeInTheDocument()
  })

  it('shows Suspend on an active venue, Reactivate on a suspended one, and neither on a draft or closed one', async () => {
    const all = [
      venue({ venue_id: 'a', name: 'Active One', slug: 'e2e-a', status: 'active' }),
      venue({ venue_id: 's', name: 'Suspended One', slug: 'e2e-s', status: 'suspended' }),
      venue({ venue_id: 'd', name: 'Draft One', slug: 'e2e-d', status: 'draft' }),
      venue({ venue_id: 'c', name: 'Closed One', slug: 'e2e-c', status: 'closed' }),
    ]
    mocks.venues.mockResolvedValue({ rows: all, total: 4 })
    renderAt()
    await screen.findByText('Active One')
    const expected: Record<string, [boolean, boolean]> = { 'Active One': [true, false], 'Suspended One': [false, true], 'Draft One': [false, false], 'Closed One': [false, false] }
    for (const [name, [suspend, reactivate]] of Object.entries(expected)) {
      await userEvent.click(detailsFor(name))
      const panel = await panelFor(name)
      expect(within(panel).queryByRole('button', { name: /^Suspend/ }) !== null).toBe(suspend)
      expect(within(panel).queryByRole('button', { name: /^Reactivate/ }) !== null).toBe(reactivate)
      // Every venue also has "Resend invite" (T14.5d).
      expect(within(panel).getByRole('button', { name: 'Resend invite' })).toBeInTheDocument()
      await userEvent.click(within(panel).getByRole('button', { name: /close/i }))
    }
  })

  it('asks for confirmation before suspending and calls suspendVenue with the venue id when confirmed', async () => {
    mocks.venues.mockResolvedValue({ rows: [venue()], total: 1 })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAt('/venues?open=v1')
    const panel = await panelFor('E2E Alpha Courts')
    await userEvent.click(within(panel).getByRole('button', { name: /^Suspend/ }))
    expect(confirm).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mocks.suspend).toHaveBeenCalledWith('v1'))
  })

  it('does not suspend when the confirmation is declined', async () => {
    mocks.venues.mockResolvedValue({ rows: [venue()], total: 1 })
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderAt('/venues?open=v1')
    const panel = await panelFor('E2E Alpha Courts')
    await userEvent.click(within(panel).getByRole('button', { name: /^Suspend/ }))
    expect(mocks.suspend).not.toHaveBeenCalled()
  })

  it('reactivates a suspended venue with its id', async () => {
    mocks.venues.mockResolvedValue({ rows: [venue({ status: 'suspended' })], total: 1 })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAt('/venues?open=v1')
    const panel = await panelFor('E2E Alpha Courts')
    await userEvent.click(within(panel).getByRole('button', { name: /^Reactivate/ }))
    await waitFor(() => expect(mocks.reactivate).toHaveBeenCalledWith('v1'))
  })

  it('reloads the page after a suspend succeeds and the panel then offers Reactivate', async () => {
    mocks.venues.mockResolvedValueOnce({ rows: [venue()], total: 1 }).mockResolvedValue({ rows: [venue({ status: 'suspended' })], total: 1 })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAt('/venues?open=v1')
    const panel = await panelFor('E2E Alpha Courts')
    await userEvent.click(within(panel).getByRole('button', { name: /^Suspend/ }))
    expect(await within(panel).findByRole('button', { name: /^Reactivate/ })).toBeInTheDocument()
    expect(mocks.venues).toHaveBeenCalledTimes(2)
  })

  it('shows the failure message in an alert when suspending fails', async () => {
    mocks.venues.mockResolvedValue({ rows: [venue()], total: 1 })
    mocks.suspend.mockRejectedValue(new Error('not_active'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAt('/venues?open=v1')
    const panel = await panelFor('E2E Alpha Courts')
    await userEvent.click(within(panel).getByRole('button', { name: /^Suspend/ }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('not_active')
  })

  it('shows the failure message in an alert when reactivating fails', async () => {
    mocks.venues.mockResolvedValue({ rows: [venue({ status: 'suspended' })], total: 1 })
    mocks.reactivate.mockRejectedValue(new Error('not_suspended'))
    renderAt('/venues?open=v1')
    const panel = await panelFor('E2E Alpha Courts')
    await userEvent.click(within(panel).getByRole('button', { name: /^Reactivate/ }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('not_suspended')
  })
})

describe('Venues filtering, paging and URL state', () => {
  it('fetches the first bounded page with the default filters (blank status means every status)', async () => {
    servePages(manyVenues(60))
    renderAt()
    await screen.findByText('E2E Venue 001')
    expect(mocks.venues).toHaveBeenCalledWith({ search: '', status: '', page: 1 })
    expect(names()).toHaveLength(25)
  })

  it('offers All, Active, Draft and Suspended under "Filter by status"', async () => {
    servePages(manyVenues(60))
    renderAt()
    const filter = await screen.findByLabelText('Filter by status')
    expect(within(filter).getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'Active', 'Draft', 'Suspended'])
    await userEvent.selectOptions(filter, 'draft')
    await waitFor(() => expect(mocks.venues).toHaveBeenLastCalledWith({ search: '', status: 'draft', page: 1 }))
    expect(params().get('status')).toBe('draft')
  })

  it('pages through 60 venues with no dropped or duplicated row and resets the page on a filter change', async () => {
    servePages(manyVenues(60))
    renderAt()
    await screen.findByText('E2E Venue 001')
    const seen: (string | null)[] = [...names()]
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('E2E Venue 026')
    seen.push(...names())
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('E2E Venue 051')
    seen.push(...names())
    expect(screen.getByText(/Showing 51\s*[–-]\s*60 of 60/)).toBeInTheDocument()
    expect(seen).toEqual(manyVenues(60).map((v) => v.name))
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'active')
    await waitFor(() => expect(mocks.venues).toHaveBeenLastCalledWith({ search: '', status: 'active', page: 1 }))
    expect(params().get('page') ?? '1').toBe('1')
    for (const [input] of mocks.venues.mock.calls) expect(Object.keys(input).sort()).toEqual(['page', 'search', 'status'])
  })

  it('searching resets to page 1 and writes ?q=; the URL restores the view and back navigation works', async () => {
    servePages(manyVenues(60))
    renderAt('/venues?page=2')
    await screen.findByText('E2E Venue 026')
    await userEvent.type(screen.getByLabelText(/search/i), 'Venue 01')
    await waitFor(() => expect(mocks.venues).toHaveBeenLastCalledWith({ search: 'Venue 01', status: '', page: 1 }), { timeout: 3000 })
    expect(params().get('q')).toBe('Venue 01')
    await userEvent.click(screen.getByRole('button', { name: 'history back' }))
    await waitFor(() => expect(mocks.venues).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })))
  })

  it('restores status, search and page from the URL on a fresh load', async () => {
    servePages(manyVenues(60))
    renderAt('/venues?status=active&q=Venue&page=2')
    await waitFor(() => expect(mocks.venues).toHaveBeenCalledWith({ search: 'Venue', status: 'active', page: 2 }))
    expect(screen.getByLabelText('Filter by status')).toHaveValue('active')
    expect(screen.getByLabelText(/search/i)).toHaveValue('Venue')
  })
})
