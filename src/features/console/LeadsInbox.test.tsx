// T14.3: the leads inbox lists leads, filters by status, updates status and notes.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Lead } from './api'

vi.mock('./api', () => ({ fetchLeads: vi.fn(), updateLead: vi.fn(), fetchIsPlatformAdmin: vi.fn() }))

const { fetchLeads, updateLead } = await import('./api')
const { LeadsInbox } = await import('./LeadsInbox')

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'l1', first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com', phone: '0917 000 0001',
    venue_name: 'E2E Padel Club', location: 'Cebu', courts: 4, facebook: null, message: null,
    status: 'new', notes: null, consented_at: '2030-01-01T00:00:00Z',
    created_at: '2030-01-02T00:00:00Z', updated_at: '2030-01-02T00:00:00Z', ...over,
  }
}

function renderInbox() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><LeadsInbox /></QueryClientProvider>)
}

beforeEach(() => {
  vi.mocked(fetchLeads).mockReset()
  vi.mocked(updateLead).mockReset()
  vi.mocked(updateLead).mockResolvedValue(undefined)
})

describe('LeadsInbox', () => {
  it('shows a loading state while leads load', () => {
    vi.mocked(fetchLeads).mockReturnValue(new Promise(() => {}))
    renderInbox()
    expect(screen.getByText('Loading leads…')).toBeInTheDocument()
  })

  it('shows "No leads yet." when there are none and the filter is All', async () => {
    vi.mocked(fetchLeads).mockResolvedValue([])
    renderInbox()
    expect(await screen.findByText('No leads yet.')).toBeInTheDocument()
  })

  it('shows "No leads with this status." when a status filter has no leads', async () => {
    vi.mocked(fetchLeads).mockResolvedValue([])
    renderInbox()
    await screen.findByText('No leads yet.')
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'won')
    expect(await screen.findByText('No leads with this status.')).toBeInTheDocument()
  })

  it('shows an error with a Retry button that loads again', async () => {
    vi.mocked(fetchLeads).mockRejectedValueOnce(new Error('boom')).mockResolvedValue([lead()])
    renderInbox()
    expect(await screen.findByText("Couldn't load leads.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('E2E Padel Club')).toBeInTheDocument()
  })

  it('lists each lead with venue, name, email, phone, location and courts', async () => {
    vi.mocked(fetchLeads).mockResolvedValue([lead(), lead({ id: 'l2', venue_name: 'E2E Hoops', first_name: 'Ben', last_name: 'Cruz', email: 'ben@example.com', courts: 2, location: 'Davao' })])
    renderInbox()
    await screen.findByText('E2E Padel Club')
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    const first = within(items[0])
    expect(first.getByText('E2E Padel Club')).toBeInTheDocument()
    expect(first.getByText(/Ana Reyes/)).toBeInTheDocument()
    expect(first.getByText(/ana@example\.com/)).toBeInTheDocument()
    expect(first.getByText(/0917 000 0001/)).toBeInTheDocument()
    expect(first.getByText(/Cebu/)).toBeInTheDocument()
    expect(first.getByText(/\b4\b/)).toBeInTheDocument()
    expect(first.getByLabelText('Status')).toHaveValue('new')
  })

  it('defaults the filter to All and fetches with the chosen status when it changes', async () => {
    vi.mocked(fetchLeads).mockResolvedValue([lead()])
    renderInbox()
    const filter = screen.getByLabelText('Filter by status')
    expect(filter).toHaveValue('all')
    expect(within(filter).getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'New', 'Talking', 'Won', 'Lost'])
    await screen.findByText('E2E Padel Club')
    expect(fetchLeads).toHaveBeenLastCalledWith('all')
    await userEvent.selectOptions(filter, 'talking')
    await vi.waitFor(() => expect(fetchLeads).toHaveBeenLastCalledWith('talking'))
  })

  it('changing a lead status calls updateLead with that status', async () => {
    vi.mocked(fetchLeads).mockResolvedValue([lead()])
    renderInbox()
    await screen.findByText('E2E Padel Club')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'won')
    expect(updateLead).toHaveBeenCalledWith('l1', { status: 'won' })
  })

  it('saving notes calls updateLead with the notes', async () => {
    vi.mocked(fetchLeads).mockResolvedValue([lead({ notes: 'called once' })])
    renderInbox()
    await screen.findByText('E2E Padel Club')
    const notes = screen.getByLabelText('Notes')
    expect(notes).toHaveValue('called once')
    await userEvent.clear(notes)
    await userEvent.type(notes, 'send demo link')
    await userEvent.click(screen.getByRole('button', { name: 'Save notes' }))
    expect(updateLead).toHaveBeenCalledWith('l1', { notes: 'send demo link' })
  })

  it('shows an alert with the message when an update fails', async () => {
    vi.mocked(fetchLeads).mockResolvedValue([lead()])
    vi.mocked(updateLead).mockRejectedValue(new Error('permission denied'))
    renderInbox()
    await screen.findByText('E2E Padel Club')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'lost')
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
  })
})
