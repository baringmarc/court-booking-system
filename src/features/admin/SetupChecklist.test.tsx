// T14.7: the setup checklist on the dashboard of a draft venue.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'
import { fetchSetupStatus, publishVenue, type SetupStatus } from './api'
import { SetupChecklist } from './SetupChecklist'

vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchSetupStatus: vi.fn(), publishVenue: vi.fn() }))

const item = (key: string, label: string, required: boolean, done: boolean) => ({ key, label, required, done })
const incomplete: SetupStatus = {
  items: [
    item('courts', 'Add a court', true, false),
    item('rates', 'Set court prices', true, false),
    item('hours', 'Set opening hours', true, true),
    item('payment', 'Add payment details', true, false),
    item('payment_instructions', 'Add payment instructions', true, false),
    item('photos', 'Add court photos', false, false),
  ],
  ready: false,
}
const ready: SetupStatus = {
  items: [
    item('courts', 'Add a court', true, true),
    item('rates', 'Set court prices', true, true),
    item('hours', 'Set opening hours', true, true),
    item('payment', 'Add payment details', true, true),
    item('payment_instructions', 'Add payment instructions', true, true),
    item('photos', 'Add court photos', false, false),
  ],
  ready: true,
}

function renderChecklist() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><SetupChecklist /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const row = (label: string) => screen.getByText(label).closest('li') as HTMLElement

describe('SetupChecklist', () => {
  beforeEach(() => {
    setCurrentVenue({ id: 'venue-a', slug: 'a-venue', status: 'draft' })
    vi.mocked(fetchSetupStatus).mockReset().mockResolvedValue(incomplete)
    vi.mocked(publishVenue).mockReset().mockResolvedValue(undefined)
  })

  it('shows a loading state before the status arrives', () => {
    vi.mocked(fetchSetupStatus).mockReturnValue(new Promise(() => undefined))
    renderChecklist()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows the "Set up your venue" heading and every item label', async () => {
    renderChecklist()
    expect(await screen.findByRole('heading', { name: 'Set up your venue' })).toBeInTheDocument()
    for (const i of incomplete.items) expect(screen.getByText(i.label)).toBeInTheDocument()
  })

  it('marks each item Done or To do, and the optional one Optional', async () => {
    renderChecklist()
    await screen.findByText('Add a court')
    expect(within(row('Add a court')).getByText('To do')).toBeInTheDocument()
    expect(within(row('Set opening hours')).getByText('Done')).toBeInTheDocument()
    expect(within(row('Add court photos')).getByText('Optional')).toBeInTheDocument()
    expect(within(row('Add a court')).queryByText('Optional')).not.toBeInTheDocument()
  })

  it('shows account details Done independently from payment instructions To do', async () => {
    vi.mocked(fetchSetupStatus).mockResolvedValue({
      items: [
        item('payment', 'Add a payment account with an account number', true, true),
        item('payment_instructions', 'Add payment instructions', true, false),
      ],
      ready: false,
    })
    renderChecklist()
    const account = await screen.findByText('Add a payment account with an account number')
    expect(within(account.closest('li') as HTMLElement).getByText('Done')).toBeInTheDocument()
    const instructions = screen.getByText('Add payment instructions')
    expect(within(instructions.closest('li') as HTMLElement).getByText('To do')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish venue' })).toBeDisabled()
  })

  it('links the missing items to where they are fixed', async () => {
    renderChecklist()
    await screen.findByText('Add a court')
    expect(within(row('Add a court')).getByRole('link')).toHaveAttribute('href', '/admin/courts')
    expect(within(row('Add payment details')).getByRole('link')).toHaveAttribute('href', '/admin/settings/payments')
    expect(within(row('Add payment instructions')).getByRole('link')).toHaveAttribute('href', '/admin/settings/payments')
  })

  it('has no link on an item that is done', async () => {
    renderChecklist()
    await screen.findByText('Set opening hours')
    expect(within(row('Set opening hours')).queryByRole('link')).not.toBeInTheDocument()
  })

  it('disables Publish venue while the venue is not ready, and does not call publishVenue', async () => {
    renderChecklist()
    const button = await screen.findByRole('button', { name: 'Publish venue' })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(publishVenue).not.toHaveBeenCalled()
  })

  it('enables Publish venue when ready and calls publishVenue once on click', async () => {
    vi.mocked(fetchSetupStatus).mockResolvedValue(ready)
    renderChecklist()
    const button = await screen.findByRole('button', { name: 'Publish venue' })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    await waitFor(() => expect(publishVenue).toHaveBeenCalledTimes(1))
  })

  it('shows a publish failure in an alert and keeps the button available', async () => {
    vi.mocked(fetchSetupStatus).mockResolvedValue(ready)
    vi.mocked(publishVenue).mockRejectedValue(new Error('Finish setting up first.'))
    renderChecklist()
    await userEvent.click(await screen.findByRole('button', { name: 'Publish venue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Finish setting up first.')
    expect(screen.getByRole('button', { name: 'Publish venue' })).toBeEnabled()
  })

  it('shows an error with a retry when the status fails to load, and retry reads it again', async () => {
    vi.mocked(fetchSetupStatus).mockRejectedValueOnce(new Error('Could not load setup.'))
    renderChecklist()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load setup.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Set up your venue' })).toBeInTheDocument()
    expect(fetchSetupStatus).toHaveBeenCalledTimes(2)
  })
})
