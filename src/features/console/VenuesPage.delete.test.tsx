// T17.28: deleting an unused venue from its panel: the preview, the typed-subdomain confirmation, the file cleanup
// retry, and the page correction after the last row of a page.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import type { Page, VenueDeletionPreview, VenueOverview } from './api'

const mocks = vi.hoisted(() => ({
  admin: vi.fn<() => Promise<boolean>>(),
  venues: vi.fn<(input: { search: string; status: string; page: number }) => Promise<unknown>>(),
  preview: vi.fn<(venueId: string) => Promise<unknown>>(),
  remove: vi.fn<(input: { venueId: string; confirmSlug: string }) => Promise<unknown>>(),
  retry: vi.fn<(venueId: string) => Promise<unknown>>(),
  approvals: vi.fn(),
}))
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  fetchIsPlatformAdmin: mocks.admin, fetchVenuesPage: mocks.venues, fetchVenueDeletionPreview: mocks.preview,
  deleteUnusedVenue: mocks.remove, retryVenueFileCleanup: mocks.retry, fetchShowcaseApprovals: mocks.approvals,
  // T18.2: the panel also reads the online payments switch.
  fetchOnlinePayments: async () => [{ venue_id: 'v1', online_payments_enabled: false }],
}))

const { ConsoleApp } = await import('./ConsoleApp')

function venue(over: Partial<VenueOverview> = {}): VenueOverview {
  return { venue_id: 'v1', slug: 'e2e-alpha', name: 'E2E Alpha Courts', status: 'draft', month_transactions: 0, month_total: 0, open_invoices: 0, ...over }
}
const zero = { bookings: 0, payments: 0, checkouts: 0, charges: 0, invoices: 0, open_play_sessions: 0, courts: 2, members: 3 }
function previewOf(over: Partial<VenueDeletionPreview> = {}): VenueDeletionPreview {
  return { slug: 'e2e-alpha', deletable: true, blockers: [], counts: zero, ...over }
}
const pad = (n: number) => String(n).padStart(3, '0')
function manyVenues(count: number): VenueOverview[] {
  return Array.from({ length: count }, (_, i) => venue({ venue_id: `v${pad(i + 1)}`, slug: `e2e-venue-${pad(i + 1)}`, name: `E2E Venue ${pad(i + 1)}` }))
}
function serve(all: VenueOverview[]) {
  mocks.venues.mockImplementation(async ({ page }) => ({ rows: all.slice((page - 1) * 25, page * 25), total: all.length } satisfies Page<VenueOverview>))
  mocks.preview.mockImplementation(async (id) => previewOf({ slug: all.find((v) => v.venue_id === id)?.slug ?? 'x' }))
  mocks.remove.mockImplementation(async ({ venueId }) => {
    all.splice(all.findIndex((v) => v.venue_id === venueId), 1)
    return { cleanup: 'done' }
  })
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
const region = (name: string) => screen.findByRole('region', { name: `Venue: ${name}` })
async function openDialog(name = 'E2E Alpha Courts') {
  const opener = within(await region(name)).getByRole('button', { name: 'Delete venue' })
  await userEvent.click(opener)
  return { opener, dialog: await screen.findByRole('dialog', { name: `Delete ${name}?` }) }
}
const confirmBox = (d: HTMLElement) => within(d).getByRole('textbox', { name: 'Type the subdomain to confirm' })
async function statusMatching(re: RegExp) {
  return waitFor(() => {
    const found = screen.queryAllByRole('status').find((el) => re.test(el.textContent ?? ''))
    expect(found).toBeDefined()
    return found as HTMLElement
  })
}

beforeEach(() => {
  mocks.admin.mockReset().mockResolvedValue(true)
  mocks.venues.mockReset().mockResolvedValue({ rows: [venue()], total: 1 })
  mocks.preview.mockReset().mockResolvedValue(previewOf())
  mocks.remove.mockReset().mockResolvedValue({ cleanup: 'done' })
  mocks.retry.mockReset().mockResolvedValue({ cleanup: 'done' })
  mocks.approvals.mockReset().mockResolvedValue([{ id: 'v1', showcase_approved: false }])
})

describe('Delete venue dialog: loading the preview', () => {
  it('opens a dialog named "Delete <name>?" and only loads the preview then, for that venue', async () => {
    renderAt('/venues?open=v1')
    await region('E2E Alpha Courts')
    expect(mocks.preview).not.toHaveBeenCalled()
    const { dialog } = await openDialog()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledWith('v1'))
    expect(await within(dialog).findByRole('textbox', { name: 'Type the subdomain to confirm' })).toBeInTheDocument()
  })

  it('shows a loading state, then an alert when the preview fails', async () => {
    mocks.preview.mockRejectedValue(new Error('preview boom'))
    renderAt('/venues?open=v1')
    const { dialog } = await openDialog()
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/preview boom|couldn't load|could not load/i)
    expect(within(dialog).queryByRole('button', { name: 'Delete venue' })).not.toBeInTheDocument()
  })

  it('moves focus into the dialog; Cancel and Escape close it and return focus to the Delete venue button', async () => {
    renderAt('/venues?open=v1')
    const { opener, dialog } = await openDialog()
    await within(dialog).findByRole('textbox', { name: 'Type the subdomain to confirm' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(mocks.remove).not.toHaveBeenCalled()

    await userEvent.click(opener)
    await screen.findByRole('dialog', { name: 'Delete E2E Alpha Courts?' })
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})

describe('Delete venue dialog: a venue that cannot be deleted', () => {
  it('lists protected and history reasons, mentions the test-data cleanup and offers no delete button', async () => {
    mocks.preview.mockResolvedValue(previewOf({ deletable: false, blockers: ['protected', 'bookings', 'payments'], counts: { ...zero, bookings: 4, payments: 2 } }))
    renderAt('/venues?open=v1')
    const { dialog } = await openDialog()
    expect(await within(dialog).findByText(/protected/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/history/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/test-data cleanup/i)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Delete venue' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /cancel|close/i })).toBeInTheDocument()
  })

  it('a venue blocked only by history is not described as protected', async () => {
    mocks.preview.mockResolvedValue(previewOf({ deletable: false, blockers: ['invoices'], counts: { ...zero, invoices: 1 } }))
    renderAt('/venues?open=v1')
    const { dialog } = await openDialog()
    expect(await within(dialog).findByText(/history/i)).toBeInTheDocument()
    expect(within(dialog).queryByText(/protected/i)).not.toBeInTheDocument()
  })

  it('a protected venue with no history is not described as having history', async () => {
    mocks.preview.mockResolvedValue(previewOf({ slug: 'claudex-courts', deletable: false, blockers: ['protected'] }))
    renderAt('/venues?open=v1')
    const { dialog } = await openDialog()
    expect(await within(dialog).findByText(/protected/i)).toBeInTheDocument()
    expect(within(dialog).queryByText(/history/i)).not.toBeInTheDocument()
  })
})

describe('Delete venue dialog: a deletable venue', () => {
  it('shows the subdomain, the courts and members counts and that accounts are kept', async () => {
    renderAt('/venues?open=v1')
    const { dialog } = await openDialog()
    await within(dialog).findByRole('textbox', { name: 'Type the subdomain to confirm' })
    expect(within(dialog).getAllByText(/e2e-alpha/).length).toBeGreaterThan(0)
    expect(within(dialog).getByText(/\b2\b\s*courts?|courts?\D{0,3}\b2\b/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/\b3\b\s*members?|members?\D{0,3}\b3\b/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/accounts are kept/i)).toBeInTheDocument()
  })

  it('keeps Delete venue disabled until the input equals the subdomain exactly', async () => {
    renderAt('/venues?open=v1')
    const { dialog } = await openDialog()
    await within(dialog).findByRole('textbox', { name: 'Type the subdomain to confirm' })
    const button = within(dialog).getByRole('button', { name: 'Delete venue' })
    expect(button).toBeDisabled()
    for (const wrong of ['e2e-alph', 'E2E-ALPHA', 'e2e-alpha ', 'e2e-alphaa', ' e2e-alpha']) {
      await userEvent.clear(confirmBox(dialog))
      await userEvent.type(confirmBox(dialog), wrong)
      expect(button).toBeDisabled()
    }
    await userEvent.clear(confirmBox(dialog))
    await userEvent.type(confirmBox(dialog), 'e2e-alpha')
    expect(button).toBeEnabled()
  })

  it('calls deleteUnusedVenue with the id and typed slug; done closes dialog and panel and reports the venue deleted', async () => {
    renderAt('/venues?open=v1')
    const { dialog } = await openDialog()
    await userEvent.type(await within(dialog).findByRole('textbox', { name: 'Type the subdomain to confirm' }), 'e2e-alpha')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete venue' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ venueId: 'v1', confirmSlug: 'e2e-alpha' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('region', { name: 'Venue: E2E Alpha Courts' })).not.toBeInTheDocument()
    expect(params().has('open')).toBe(false)
    const status = await statusMatching(/deleted/i)
    expect(status).toHaveTextContent('E2E Alpha Courts')
    expect(mocks.retry).not.toHaveBeenCalled()
  })

  it('reloads the venues list after a delete', async () => {
    renderAt('/venues?open=v1')
    const { dialog } = await openDialog()
    const before = mocks.venues.mock.calls.length
    await userEvent.type(await within(dialog).findByRole('textbox', { name: 'Type the subdomain to confirm' }), 'e2e-alpha')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete venue' }))
    await waitFor(() => expect(mocks.venues.mock.calls.length).toBeGreaterThan(before))
    await waitFor(() => expect(mocks.approvals.mock.calls.length).toBeGreaterThanOrEqual(1))
  })

  it('shows a server refusal (confirmation_mismatch) in an alert and keeps the dialog open', async () => {
    mocks.remove.mockRejectedValue(Object.assign(new Error('The subdomain does not match.'), { hint: 'confirmation_mismatch' }))
    renderAt('/venues?open=v1')
    const { dialog } = await openDialog()
    await userEvent.type(await within(dialog).findByRole('textbox', { name: 'Type the subdomain to confirm' }), 'e2e-alpha')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete venue' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The subdomain does not match.')
    expect(screen.getByRole('dialog', { name: 'Delete E2E Alpha Courts?' })).toBeInTheDocument()
    expect(params().get('open')).toBe('v1')
  })
})

describe('Delete venue dialog: file cleanup pending', () => {
  async function deleteToPending() {
    mocks.remove.mockResolvedValue({ cleanup: 'pending' })
    renderAt('/venues?open=v1')
    const { dialog } = await openDialog()
    await userEvent.type(await within(dialog).findByRole('textbox', { name: 'Type the subdomain to confirm' }), 'e2e-alpha')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete venue' }))
    return dialog
  }

  it('stays open with a pending message and a Retry cleanup button', async () => {
    const dialog = await deleteToPending()
    expect(await within(dialog).findByRole('status')).toHaveTextContent(/file cleanup is pending/i)
    expect(within(dialog).getByRole('button', { name: 'Retry cleanup' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Delete E2E Alpha Courts?' })).toBeInTheDocument()
    expect(mocks.retry).not.toHaveBeenCalled()
  })

  it('Retry cleanup calls retryVenueFileCleanup with the venue id; done closes and reports the venue deleted', async () => {
    const dialog = await deleteToPending()
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Retry cleanup' }))
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith('v1'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(params().has('open')).toBe(false)
    const status = await statusMatching(/deleted/i)
    expect(status).toHaveTextContent('E2E Alpha Courts')
    expect(mocks.remove).toHaveBeenCalledTimes(1)
  })

  it('a retry that is still pending keeps the dialog and the message; a failed retry shows an alert', async () => {
    const dialog = await deleteToPending()
    mocks.retry.mockResolvedValueOnce({ cleanup: 'pending' }).mockRejectedValueOnce(new Error('retry boom'))
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Retry cleanup' }))
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledTimes(1))
    expect(await within(dialog).findByRole('status')).toHaveTextContent(/file cleanup is pending/i)
    expect(screen.getByRole('dialog', { name: 'Delete E2E Alpha Courts?' })).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry cleanup' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('retry boom')
  })
})

describe('Page correction after a delete', () => {
  async function deleteOpen(name: string, slug: string) {
    const { dialog } = await openDialog(name)
    await userEvent.type(await within(dialog).findByRole('textbox', { name: 'Type the subdomain to confirm' }), slug)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete venue' }))
  }

  it('deleting the only row on page 3 moves to page 2', async () => {
    serve(manyVenues(51))
    renderAt('/venues?page=3&open=v051')
    await deleteOpen('E2E Venue 051', 'e2e-venue-051')
    await waitFor(() => expect(params().get('page')).toBe('2'))
    expect(await screen.findByText('E2E Venue 050')).toBeInTheDocument()
    expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument()
  })

  it('deleting the only row on page 2 moves to page 1', async () => {
    serve(manyVenues(26))
    renderAt('/venues?page=2&open=v026')
    await deleteOpen('E2E Venue 026', 'e2e-venue-026')
    await waitFor(() => expect(params().get('page') ?? '1').toBe('1'))
    expect(await screen.findByText('E2E Venue 025')).toBeInTheDocument()
    expect(screen.queryByText(/No venues/)).not.toBeInTheDocument()
  })
})
