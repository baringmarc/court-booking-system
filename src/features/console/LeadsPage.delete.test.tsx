// T17.28: deleting a lead from its panel, behind a confirmation dialog, and the page correction after the last row of a page.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import type { Lead, Page } from './api'

const mocks = vi.hoisted(() => ({
  admin: vi.fn<() => Promise<boolean>>(),
  leads: vi.fn<(input: { status: string; search: string; page: number }) => Promise<unknown>>(),
  remove: vi.fn<(id: string) => Promise<void>>(),
}))
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  fetchIsPlatformAdmin: mocks.admin, fetchLeadsPage: mocks.leads, deleteLead: mocks.remove,
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
function manyLeads(count: number): Lead[] {
  return Array.from({ length: count }, (_, i) => lead({
    id: `l${pad(i + 1)}`, venue_name: `E2E Lead ${pad(i + 1)}`, first_name: 'Pat', last_name: `Person${pad(i + 1)}`, email: `pat${i + 1}@example.com`,
  }))
}
/** Serves pages from `all`; deleting removes the row, as the database would. */
function serve(all: Lead[]) {
  mocks.leads.mockImplementation(async ({ page }) => ({ rows: all.slice((page - 1) * 25, page * 25), total: all.length } satisfies Page<Lead>))
  mocks.remove.mockImplementation(async (id) => { all.splice(all.findIndex((l) => l.id === id), 1) })
}

function Probe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}
function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}><AuthContext.Provider value={authState('admin')}>
      <MemoryRouter initialEntries={[path]}><ConsoleApp /><Probe /></MemoryRouter>
    </AuthContext.Provider></QueryClientProvider>,
  )
}
const params = () => new URL(screen.getByTestId('location').textContent ?? '', 'http://x').searchParams
const panel = (name: string) => screen.findByRole('region', { name: `Lead: ${name}` })
const dialog = () => screen.findByRole('dialog', { name: 'Delete lead?' })
async function openDialog(name = 'E2E Padel Club') {
  const region = await panel(name)
  const opener = within(region).getByRole('button', { name: 'Delete lead' })
  await userEvent.click(opener)
  return { opener, dialog: await dialog() }
}

beforeEach(() => {
  mocks.admin.mockReset().mockResolvedValue(true)
  mocks.leads.mockReset()
  mocks.remove.mockReset().mockResolvedValue(undefined)
})

describe('Delete lead dialog', () => {
  it('offers "Delete lead" in the panel and opens a dialog naming the contact and venue and warning the notes are lost', async () => {
    mocks.leads.mockResolvedValue({ rows: [lead()], total: 1 })
    renderAt('/leads?open=l1')
    const { dialog: d } = await openDialog()
    expect(d).toHaveAttribute('aria-modal', 'true')
    expect(within(d).getByText(/Ana Reyes/)).toBeInTheDocument()
    expect(within(d).getByText(/E2E Padel Club/)).toBeInTheDocument()
    expect(within(d).getByText(/notes/i)).toHaveTextContent(/lost|deleted|gone|cannot|can't/i)
    expect(within(d).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(d).getByRole('button', { name: 'Delete lead' })).toBeInTheDocument()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('focuses Cancel first', async () => {
    mocks.leads.mockResolvedValue({ rows: [lead()], total: 1 })
    renderAt('/leads?open=l1')
    const { dialog: d } = await openDialog()
    expect(within(d).getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('Cancel closes the dialog without deleting and returns focus to the Delete lead button', async () => {
    mocks.leads.mockResolvedValue({ rows: [lead()], total: 1 })
    renderAt('/leads?open=l1')
    const { opener, dialog: d } = await openDialog()
    await userEvent.click(within(d).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Delete lead?' })).not.toBeInTheDocument()
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(opener).toHaveFocus()
    expect(params().get('open')).toBe('l1')
  })

  it('Escape cancels and returns focus to the opening button', async () => {
    mocks.leads.mockResolvedValue({ rows: [lead()], total: 1 })
    renderAt('/leads?open=l1')
    const { opener } = await openDialog()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Delete lead?' })).not.toBeInTheDocument()
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(opener).toHaveFocus()
  })

  it('confirming calls deleteLead with the id, closes the panel and shows a status naming the venue as deleted', async () => {
    const all = [lead(), lead({ id: 'l2', venue_name: 'E2E Hoops' })]
    serve(all)
    renderAt('/leads?open=l1')
    const { dialog: d } = await openDialog()
    await userEvent.click(within(d).getByRole('button', { name: 'Delete lead' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('l1'))
    await waitFor(() => expect(params().has('open')).toBe(false))
    expect(screen.queryByRole('dialog', { name: 'Delete lead?' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Lead: E2E Padel Club' })).not.toBeInTheDocument()
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('E2E Padel Club')
    expect(status).toHaveTextContent(/deleted/i)
    // The list reloads without the deleted lead.
    await waitFor(() => expect(screen.queryByText('E2E Padel Club', { selector: 'strong' })).not.toBeInTheDocument())
    expect(screen.getByText('E2E Hoops')).toBeInTheDocument()
  })

  it('shows the error message in an alert and keeps the panel when the delete fails', async () => {
    mocks.leads.mockResolvedValue({ rows: [lead()], total: 1 })
    mocks.remove.mockRejectedValue(new Error('Only platform admins can delete leads.'))
    renderAt('/leads?open=l1')
    const { dialog: d } = await openDialog()
    await userEvent.click(within(d).getByRole('button', { name: 'Delete lead' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only platform admins can delete leads.')
    expect(params().get('open')).toBe('l1')
    expect(screen.queryByText(/deleted/i, { selector: '[role="status"]' })).not.toBeInTheDocument()
  })
})

describe('Page correction after a delete', () => {
  it('deleting the only row on page 3 moves to page 2', async () => {
    serve(manyLeads(51))
    renderAt('/leads?page=3&open=l051')
    const { dialog: d } = await openDialog('E2E Lead 051')
    await userEvent.click(within(d).getByRole('button', { name: 'Delete lead' }))
    await waitFor(() => expect(params().get('page')).toBe('2'))
    expect(await screen.findByText('E2E Lead 050')).toBeInTheDocument()
    expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument()
  })

  it('deleting the only row on page 2 moves to page 1', async () => {
    serve(manyLeads(26))
    renderAt('/leads?page=2&open=l026')
    const { dialog: d } = await openDialog('E2E Lead 026')
    await userEvent.click(within(d).getByRole('button', { name: 'Delete lead' }))
    await waitFor(() => expect(params().get('page') ?? '1').toBe('1'))
    expect(await screen.findByText('E2E Lead 025')).toBeInTheDocument()
    expect(screen.queryByText(/No leads/)).not.toBeInTheDocument()
  })

  it('stays on the page when the page still has rows after the delete', async () => {
    serve(manyLeads(52))
    renderAt('/leads?page=3&open=l051')
    const { dialog: d } = await openDialog('E2E Lead 051')
    await userEvent.click(within(d).getByRole('button', { name: 'Delete lead' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalled())
    expect(await screen.findByText('E2E Lead 052')).toBeInTheDocument()
    expect(params().get('page')).toBe('3')
  })
})
