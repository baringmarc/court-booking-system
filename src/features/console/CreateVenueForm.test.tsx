// T14.6: create a venue from a lead: seeding, success and failure paths.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import type { Lead } from './api'

vi.mock('./api', () => ({
  fetchLeads: vi.fn(), updateLead: vi.fn(), fetchIsPlatformAdmin: vi.fn(),
  createVenue: vi.fn(), inviteVenueOwner: vi.fn(),
}))

const { createVenue, inviteVenueOwner, updateLead } = await import('./api')
const { CreateVenueForm } = await import('./CreateVenueForm')

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'l1', first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com', phone: '0917 000 0001',
    venue_name: 'Smash Pickleball Club', location: 'Cebu', courts: 4, facebook: null, message: null,
    status: 'new', notes: null, consented_at: '2030-01-01T00:00:00Z',
    created_at: '2030-01-02T00:00:00Z', updated_at: '2030-01-02T00:00:00Z', ...over,
  }
}

const onClose = vi.fn()

function renderForm(l: Lead = lead()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><CreateVenueForm lead={l} onClose={onClose} /></QueryClientProvider>)
}

const submit = () => userEvent.click(screen.getByRole('button', { name: 'Create venue and invite owner' }))

beforeEach(() => {
  for (const f of [createVenue, inviteVenueOwner, updateLead]) vi.mocked(f).mockReset()
  onClose.mockReset()
  vi.mocked(createVenue).mockResolvedValue('v-1')
  vi.mocked(inviteVenueOwner).mockResolvedValue({ invited: true })
  vi.mocked(updateLead).mockResolvedValue(undefined)
})

describe('CreateVenueForm seeding', () => {
  it('seeds name, subdomain, timezone and owner email from the lead', () => {
    renderForm()
    expect(screen.getByLabelText('Venue name')).toHaveValue('Smash Pickleball Club')
    expect(screen.getByLabelText('Subdomain')).toHaveValue('smash-pickleball-club')
    expect(screen.getByLabelText('Timezone')).toHaveValue('Asia/Manila')
    expect(screen.getByLabelText('Owner email')).toHaveValue('ana@example.com')
    expect(screen.getByText(/smash-pickleball-club\.plotline\.fit/)).toBeInTheDocument()
  })

  it('updates the address preview when the subdomain is edited', async () => {
    renderForm()
    const sub = screen.getByLabelText('Subdomain')
    await userEvent.clear(sub)
    await userEvent.type(sub, 'smash')
    expect(screen.getByText(/smash\.plotline\.fit/)).toBeInTheDocument()
  })
})

describe('CreateVenueForm success', () => {
  it('creates the venue, invites the owner, marks the lead won and says so', async () => {
    renderForm()
    await submit()
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/invited/i)
    expect(status).toHaveTextContent('smash-pickleball-club.plotline.fit')
    expect(createVenue).toHaveBeenCalledWith({ slug: 'smash-pickleball-club', name: 'Smash Pickleball Club', timezone: 'Asia/Manila' })
    expect(inviteVenueOwner).toHaveBeenCalledWith({ venueId: 'v-1', email: 'ana@example.com' })
    expect(updateLead).toHaveBeenCalledWith('l1', { status: 'won' })
  })

  it('uses the edited values when creating', async () => {
    renderForm()
    const sub = screen.getByLabelText('Subdomain')
    await userEvent.clear(sub)
    await userEvent.type(sub, 'smash')
    const email = screen.getByLabelText('Owner email')
    await userEvent.clear(email)
    await userEvent.type(email, 'owner@example.com')
    await submit()
    await screen.findByRole('status')
    expect(createVenue).toHaveBeenCalledWith(expect.objectContaining({ slug: 'smash' }))
    expect(inviteVenueOwner).toHaveBeenCalledWith({ venueId: 'v-1', email: 'owner@example.com' })
  })

  it('the Close button calls onClose', async () => {
    renderForm()
    await submit()
    await screen.findByRole('status')
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('disables the submit button while pending', async () => {
    vi.mocked(createVenue).mockReturnValue(new Promise(() => {}))
    renderForm()
    await submit()
    expect(await screen.findByRole('button', { name: /Create venue and invite owner/ })).toBeDisabled()
  })
})

describe('CreateVenueForm failures', () => {
  it('slug_taken says the subdomain is taken, keeps typed values, does not invite or mark won', async () => {
    vi.mocked(createVenue).mockRejectedValue(new ApiError('slug taken', 'P0001', 'slug_taken'))
    renderForm()
    const sub = screen.getByLabelText('Subdomain')
    await userEvent.clear(sub)
    await userEvent.type(sub, 'smash')
    await submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(/taken/i)
    expect(screen.getByLabelText('Subdomain')).toHaveValue('smash')
    expect(inviteVenueOwner).not.toHaveBeenCalled()
    expect(updateLead).not.toHaveBeenCalled()
  })

  it('slug_reserved says the subdomain is reserved', async () => {
    vi.mocked(createVenue).mockRejectedValue(new ApiError('reserved', 'P0001', 'slug_reserved'))
    renderForm()
    await submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(/reserved/i)
  })

  it('other errors show the error message', async () => {
    vi.mocked(createVenue).mockRejectedValue(new ApiError('Platform admins only.', 'P0001', 'not_platform_admin'))
    renderForm()
    await submit()
    expect(await screen.findByRole('alert')).toHaveTextContent('Platform admins only.')
    expect(screen.getByLabelText('Venue name')).toHaveValue('Smash Pickleball Club')
  })

  it('a failed invite does not mark the lead won, and a retry reuses the created venue', async () => {
    vi.mocked(inviteVenueOwner).mockRejectedValueOnce(new ApiError('Email failed.')).mockResolvedValue({ invited: true })
    renderForm()
    await submit()
    expect(await screen.findByRole('alert')).toHaveTextContent('Email failed.')
    expect(createVenue).toHaveBeenCalledTimes(1)
    expect(updateLead).not.toHaveBeenCalled()
    await submit()
    expect(await screen.findByRole('status')).toHaveTextContent(/invited/i)
    expect(createVenue).toHaveBeenCalledTimes(1)
    expect(inviteVenueOwner).toHaveBeenCalledTimes(2)
    expect(inviteVenueOwner).toHaveBeenLastCalledWith({ venueId: 'v-1', email: 'ana@example.com' })
    expect(updateLead).toHaveBeenCalledWith('l1', { status: 'won' })
  })
})
