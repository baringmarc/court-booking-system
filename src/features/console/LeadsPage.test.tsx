// T17.19: the routed Leads page. Migrates LeadsInbox.test.tsx and LeadsInbox.createVenue.test.tsx (see the report's map)
// and adds paging, URL state, detail panel and kept notes drafts.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import type { Lead, LeadStatus, Page } from './api'

const mocks = vi.hoisted(() => ({
  admin: vi.fn<() => Promise<boolean>>(),
  leads: vi.fn<(input: { status: string; search: string; page: number }) => Promise<unknown>>(),
  update: vi.fn<(id: string, patch: { status?: string; notes?: string | null }) => Promise<void>>(),
  createVenue: vi.fn(), invite: vi.fn(),
}))
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  fetchIsPlatformAdmin: mocks.admin, fetchLeadsPage: mocks.leads, updateLead: mocks.update,
  createVenue: mocks.createVenue, inviteVenueOwner: mocks.invite,
}))

const { ConsoleApp } = await import('./ConsoleApp')

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'l1', first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com', phone: '0917 000 0001',
    venue_name: 'E2E Padel Club', location: 'Cebu', courts: 4, facebook: null, message: null,
    status: 'new', notes: null, consented_at: '2030-01-01T00:00:00Z',
    created_at: '2030-01-02T00:00:00Z', updated_at: '2030-01-02T00:00:00Z', ...over,
  }
}

const pad = (n: number) => String(n).padStart(3, '0')
/** `count` leads, "E2E Lead 001" first (newest first, as the api returns them). Every third is talking, the rest new. */
function manyLeads(count: number): Lead[] {
  return Array.from({ length: count }, (_, i) => lead({
    id: `l${pad(i + 1)}`, venue_name: `E2E Lead ${pad(i + 1)}`, first_name: 'Pat', last_name: `Person${pad(i + 1)}`,
    email: `pat${i + 1}@example.com`, status: (i + 1) % 3 === 0 ? 'talking' : 'new',
  }))
}
function servePages(all: Lead[]) {
  mocks.leads.mockImplementation(async ({ status, search, page }) => {
    const rows = all.filter((l) => (status === 'all' || l.status === status) && l.venue_name.toLowerCase().includes(search.toLowerCase()))
    return { rows: rows.slice((page - 1) * 25, page * 25), total: rows.length } satisfies Page<Lead>
  })
}

function Probe() {
  const location = useLocation()
  const navigate = useNavigate()
  return <div><div data-testid="location">{location.pathname + location.search}</div><button type="button" onClick={() => void navigate(-1)}>history back</button></div>
}
function renderAt(path = '/leads') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}><AuthContext.Provider value={authState('admin')}>
      <MemoryRouter initialEntries={[path]}><ConsoleApp /><Probe /></MemoryRouter>
    </AuthContext.Provider></QueryClientProvider>,
  )
}
const url = () => screen.getByTestId('location').textContent ?? ''
const params = () => new URL(url(), 'http://x').searchParams
const names = () => screen.queryAllByText(/^E2E Lead \d{3}$/).map((e) => e.textContent)
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
  mocks.leads.mockReset()
  mocks.update.mockReset().mockResolvedValue(undefined)
  mocks.createVenue.mockReset().mockResolvedValue('v-1')
  mocks.invite.mockReset().mockResolvedValue({ invited: true })
})

describe('Leads page states (was LeadsInbox)', () => {
  it('shows a loading state while leads load', async () => {
    mocks.leads.mockReturnValue(new Promise(() => {}))
    renderAt()
    expect(await screen.findByText('Loading leads…')).toBeInTheDocument()
  })

  it('shows "No leads yet." when there are none and no filter is set', async () => {
    mocks.leads.mockResolvedValue({ rows: [], total: 0 })
    renderAt()
    expect(await screen.findByText('No leads yet.')).toBeInTheDocument()
  })

  it('shows "No leads with this status." when a status filter has no leads', async () => {
    mocks.leads.mockResolvedValue({ rows: [], total: 0 })
    renderAt()
    await screen.findByText('No leads yet.')
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'won')
    expect(await screen.findByText('No leads with this status.')).toBeInTheDocument()
  })

  it('shows a filtered-empty message (not "No leads yet.") when a search finds nothing', async () => {
    servePages(manyLeads(3))
    renderAt('/leads?q=zzz')
    expect(await screen.findByText(/no leads/i)).toBeInTheDocument()
    expect(screen.queryByText('No leads yet.')).not.toBeInTheDocument()
  })

  it('shows an error with a Retry button that loads again', async () => {
    mocks.leads.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ rows: [lead()], total: 1 })
    renderAt()
    expect(await screen.findByText("Couldn't load leads.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('E2E Padel Club')).toBeInTheDocument()
  })
})

describe('Leads rows and detail panel', () => {
  it('lists compact rows with venue and contact name and status, and keeps the editors out of the list', async () => {
    mocks.leads.mockResolvedValue({ rows: [lead(), lead({ id: 'l2', venue_name: 'E2E Hoops', first_name: 'Ben', last_name: 'Cruz', status: 'won' })], total: 2 })
    renderAt()
    const first = (await screen.findByText('E2E Padel Club')).closest('li')!
    expect(within(first).getByText(/Ana Reyes/)).toBeInTheDocument()
    expect(within(first).getByText(/new/i)).toBeInTheDocument()
    const second = screen.getByText('E2E Hoops').closest('li')!
    expect(within(second).getByText(/Ben Cruz/)).toBeInTheDocument()
    expect(within(second).getByText(/won/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save notes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create venue' })).not.toBeInTheDocument()
  })

  it('opens a labelled panel from a row\'s Details button and records it as ?open=', async () => {
    mocks.leads.mockResolvedValue({ rows: [lead(), lead({ id: 'l2', venue_name: 'E2E Hoops' })], total: 2 })
    renderAt()
    await screen.findByText('E2E Hoops')
    await userEvent.click(detailsFor('E2E Hoops'))
    const panel = await panelFor('E2E Hoops')
    expect(params().get('open')).toBe('l2')
    expect(within(panel).getByLabelText('Notes')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /E2E Padel Club/i })).not.toBeInTheDocument()
  })

  it('shows email, phone, location and courts in the panel', async () => {
    mocks.leads.mockResolvedValue({ rows: [lead()], total: 1 })
    renderAt('/leads?open=l1')
    const panel = await panelFor('E2E Padel Club')
    expect(within(panel).getByText(/ana@example\.com/)).toBeInTheDocument()
    expect(within(panel).getByText(/0917 000 0001/)).toBeInTheDocument()
    expect(within(panel).getByText(/Cebu/)).toBeInTheDocument()
    expect(within(panel).getByText(/\b4\b/)).toBeInTheDocument()
    expect(within(panel).getByLabelText('Status')).toHaveValue('new')
  })

  it('closes the panel with Close and drops ?open=', async () => {
    mocks.leads.mockResolvedValue({ rows: [lead()], total: 1 })
    renderAt('/leads?open=l1')
    const panel = await panelFor('E2E Padel Club')
    await userEvent.click(within(panel).getByRole('button', { name: /close/i }))
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument()
    expect(params().has('open')).toBe(false)
  })

  it('changing a lead status calls updateLead with that status', async () => {
    mocks.leads.mockResolvedValue({ rows: [lead()], total: 1 })
    renderAt('/leads?open=l1')
    const panel = await panelFor('E2E Padel Club')
    await userEvent.selectOptions(within(panel).getByLabelText('Status'), 'won')
    expect(mocks.update).toHaveBeenCalledWith('l1', { status: 'won' })
  })

  it('saving notes calls updateLead with the notes, then reloads the page of leads', async () => {
    mocks.leads.mockResolvedValue({ rows: [lead({ notes: 'called once' })], total: 1 })
    renderAt('/leads?open=l1')
    const panel = await panelFor('E2E Padel Club')
    const notes = within(panel).getByLabelText('Notes')
    expect(notes).toHaveValue('called once')
    await userEvent.clear(notes)
    await userEvent.type(notes, 'send demo link')
    await userEvent.click(within(panel).getByRole('button', { name: 'Save notes' }))
    expect(mocks.update).toHaveBeenCalledWith('l1', { notes: 'send demo link' })
    await waitFor(() => expect(mocks.leads.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('shows an alert with the message when an update fails', async () => {
    mocks.leads.mockResolvedValue({ rows: [lead()], total: 1 })
    mocks.update.mockRejectedValue(new Error('permission denied'))
    renderAt('/leads?open=l1')
    const panel = await panelFor('E2E Padel Club')
    await userEvent.selectOptions(within(panel).getByLabelText('Status'), 'lost')
    expect(await within(panel).findByRole('alert')).toHaveTextContent('permission denied')
  })

  it.each([['a', 'Alpha', 'new', true], ['b', 'Bravo', 'talking', true], ['c', 'Charlie', 'won', false], ['d', 'Delta', 'lost', false]] as const)(
    'offers "Create venue" on new and talking leads only (%s %s)',
    async (id, venueName, status, expected) => {
      mocks.leads.mockResolvedValue({ rows: [lead({ id, venue_name: venueName, status: status as LeadStatus })], total: 1 })
      renderAt(`/leads?open=${id}`)
      const panel = await panelFor(venueName)
      expect(within(panel).queryByRole('button', { name: 'Create venue' }) !== null).toBe(expected)
    },
  )

  it('"Create venue" opens the form seeded for that lead inside its panel', async () => {
    mocks.leads.mockResolvedValue({ rows: [lead({ id: 'b', venue_name: 'Bravo Club', email: 'b@example.com' })], total: 1 })
    renderAt('/leads?open=b')
    const panel = await panelFor('Bravo Club')
    await userEvent.click(within(panel).getByRole('button', { name: 'Create venue' }))
    expect(within(panel).getByLabelText('Venue name')).toHaveValue('Bravo Club')
    expect(within(panel).getByLabelText('Owner email')).toHaveValue('b@example.com')
  })

  it('creates the venue, invites the owner and marks the lead won from the panel', async () => {
    mocks.leads.mockResolvedValue({ rows: [lead({ venue_name: 'Smash Club' })], total: 1 })
    renderAt('/leads?open=l1')
    const panel = await panelFor('Smash Club')
    await userEvent.click(within(panel).getByRole('button', { name: 'Create venue' }))
    await userEvent.click(within(panel).getByRole('button', { name: 'Create venue and invite owner' }))
    expect(await within(panel).findByRole('status')).toHaveTextContent('smash-club.plotline.fit')
    expect(mocks.createVenue).toHaveBeenCalledWith({ slug: 'smash-club', name: 'Smash Club', timezone: 'Asia/Manila' })
    expect(mocks.invite).toHaveBeenCalledWith({ venueId: 'v-1', email: 'ana@example.com' })
    expect(mocks.update).toHaveBeenCalledWith('l1', { status: 'won' })
  })

  it('retries a failed invite without creating the venue twice', async () => {
    mocks.leads.mockResolvedValue({ rows: [lead({ venue_name: 'Smash Club' })], total: 1 })
    mocks.invite.mockRejectedValueOnce(new Error('invite failed')).mockResolvedValue({ invited: true })
    renderAt('/leads?open=l1')
    const panel = await panelFor('Smash Club')
    await userEvent.click(within(panel).getByRole('button', { name: 'Create venue' }))
    await userEvent.click(within(panel).getByRole('button', { name: 'Create venue and invite owner' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('invite failed')
    expect(mocks.update).not.toHaveBeenCalled()
    await userEvent.click(within(panel).getByRole('button', { name: 'Create venue and invite owner' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('l1', { status: 'won' }))
    expect(mocks.createVenue).toHaveBeenCalledTimes(1)
  })
})

describe('Leads filtering, paging and URL state', () => {
  it('fetches the first bounded page with the default filters', async () => {
    servePages(manyLeads(60))
    renderAt()
    await screen.findByText('E2E Lead 001')
    expect(mocks.leads).toHaveBeenCalledWith({ status: 'all', search: '', page: 1 })
    expect(names()).toHaveLength(25)
  })

  it('offers All, New, Talking, Won and Lost under "Filter by status" and fetches with the chosen status', async () => {
    servePages(manyLeads(60))
    renderAt()
    const filter = await screen.findByLabelText('Filter by status')
    expect(filter).toHaveValue('all')
    expect(within(filter).getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'New', 'Talking', 'Won', 'Lost'])
    await userEvent.selectOptions(filter, 'talking')
    await waitFor(() => expect(mocks.leads).toHaveBeenLastCalledWith({ status: 'talking', search: '', page: 1 }))
    expect(params().get('status')).toBe('talking')
    await waitFor(() => expect(names()).toHaveLength(20))
  })

  it('pages through 60 leads: 25, 25, 10 with no dropped or duplicated row at the boundaries', async () => {
    servePages(manyLeads(60))
    renderAt()
    await screen.findByText('E2E Lead 001')
    const seen: string[] = []
    const collect = () => seen.push(...names().map((n) => n ?? ''))
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument()
    expect(screen.getByText(/Showing 1\s*[–-]\s*25 of 60/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(names()[0]).toBe('E2E Lead 001')
    expect(names()[24]).toBe('E2E Lead 025')
    collect()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('E2E Lead 026')
    expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument()
    expect(screen.getByText(/Showing 26\s*[–-]\s*50 of 60/)).toBeInTheDocument()
    expect(names()).toHaveLength(25)
    expect(params().get('page')).toBe('2')
    collect()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('E2E Lead 051')
    expect(screen.getByText(/Page 3 of 3/)).toBeInTheDocument()
    expect(screen.getByText(/Showing 51\s*[–-]\s*60 of 60/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(names()).toHaveLength(10)
    collect()

    expect(seen).toHaveLength(60)
    expect(new Set(seen).size).toBe(60)
    expect(seen).toEqual(manyLeads(60).map((l) => l.venue_name))
    // Bounded: only the three pages were ever requested, never a full list.
    for (const [input] of mocks.leads.mock.calls) expect(Object.keys(input).sort()).toEqual(['page', 'search', 'status'])
    expect(Math.max(...mocks.leads.mock.calls.map(([input]) => input.page))).toBe(3)
  })

  it('Previous goes back a page', async () => {
    servePages(manyLeads(60))
    renderAt('/leads?page=2')
    await screen.findByText('E2E Lead 026')
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('E2E Lead 001')).toBeInTheDocument()
    expect(screen.queryByText('E2E Lead 026')).not.toBeInTheDocument()
  })

  it('changing the status filter resets the page to 1', async () => {
    servePages(manyLeads(60))
    renderAt('/leads?page=3')
    await screen.findByText('E2E Lead 051')
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'new')
    await waitFor(() => expect(mocks.leads).toHaveBeenLastCalledWith({ status: 'new', search: '', page: 1 }))
    expect(params().get('page') ?? '1').toBe('1')
    expect(await screen.findByText('E2E Lead 001')).toBeInTheDocument()
  })

  it('searching fetches with the term from page 1 and writes it to ?q=', async () => {
    servePages(manyLeads(60))
    renderAt('/leads?page=3')
    await screen.findByText('E2E Lead 051')
    await userEvent.type(screen.getByLabelText(/search/i), 'Lead 05')
    await waitFor(() => expect(mocks.leads).toHaveBeenLastCalledWith({ status: 'all', search: 'Lead 05', page: 1 }), { timeout: 3000 })
    expect(params().get('q')).toBe('Lead 05')
    expect(params().get('page') ?? '1').toBe('1')
    await waitFor(() => expect(names()).toHaveLength(10))
  })

  it('restores the filters, search and page from the URL on a fresh load', async () => {
    servePages(manyLeads(60))
    renderAt('/leads?status=new&q=Lead&page=2')
    await waitFor(() => expect(mocks.leads).toHaveBeenCalledWith({ status: 'new', search: 'Lead', page: 2 }))
    expect(screen.getByLabelText('Filter by status')).toHaveValue('new')
    expect(screen.getByLabelText(/search/i)).toHaveValue('Lead')
    expect(await screen.findByText(/Page 2 of 2/)).toBeInTheDocument()
  })

  it('back navigation restores the previous page and the previous filter', async () => {
    servePages(manyLeads(60))
    renderAt()
    await screen.findByText('E2E Lead 001')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('E2E Lead 026')
    await userEvent.click(screen.getByRole('button', { name: 'history back' }))
    expect(await screen.findByText('E2E Lead 001')).toBeInTheDocument()
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'talking')
    await waitFor(() => expect(names()).toHaveLength(20))
    await userEvent.click(screen.getByRole('button', { name: 'history back' }))
    await waitFor(() => expect(screen.getByLabelText('Filter by status')).toHaveValue('all'))
    expect(await screen.findByText(/Page 1 of 3/)).toBeInTheDocument()
  })

  it('reloads the current page after an update (keys stay under the leads prefix)', async () => {
    servePages(manyLeads(60))
    renderAt('/leads?page=2&open=l026')
    const panel = await panelFor('E2E Lead 026')
    const before = mocks.leads.mock.calls.length
    await userEvent.selectOptions(within(panel).getByLabelText('Status'), 'lost')
    await waitFor(() => expect(mocks.leads.mock.calls.length).toBeGreaterThan(before))
    expect(mocks.leads).toHaveBeenLastCalledWith({ status: 'all', search: '', page: 2 })
  })
})

describe('Leads unsaved notes', () => {
  it('keeps typed notes when the admin pages away and back, until saved', async () => {
    servePages(manyLeads(60))
    renderAt('/leads?open=l001')
    let panel = await panelFor('E2E Lead 001')
    const notes = within(panel).getByLabelText('Notes')
    fireEvent.change(notes, { target: { value: 'draft not saved yet' } })
    await userEvent.click(within(panel).getByRole('button', { name: /close/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('E2E Lead 026')
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await screen.findByText('E2E Lead 001')
    await userEvent.click(detailsFor('E2E Lead 001'))
    panel = await panelFor('E2E Lead 001')
    expect(within(panel).getByLabelText('Notes')).toHaveValue('draft not saved yet')
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('keeps each lead\'s draft separate', async () => {
    servePages(manyLeads(3))
    renderAt('/leads?open=l001')
    let panel = await panelFor('E2E Lead 001')
    fireEvent.change(within(panel).getByLabelText('Notes'), { target: { value: 'only for one' } })
    await userEvent.click(within(panel).getByRole('button', { name: /close/i }))
    await userEvent.click(detailsFor('E2E Lead 002'))
    panel = await panelFor('E2E Lead 002')
    expect(within(panel).getByLabelText('Notes')).toHaveValue('')
  })
})
