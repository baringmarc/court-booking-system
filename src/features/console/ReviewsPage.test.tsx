// T17.19: the routed Reviews page. Migrates ReviewsInbox.test.tsx and adds paging, URL state and the detail panel.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import type { Page, Review } from './api'

const mocks = vi.hoisted(() => ({
  admin: vi.fn<() => Promise<boolean>>(),
  reviews: vi.fn<(input: { approved: string; search: string; page: number }) => Promise<unknown>>(),
  set: vi.fn<(id: string, approved: boolean) => Promise<void>>(),
}))
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  fetchIsPlatformAdmin: mocks.admin, fetchReviewsPage: mocks.reviews, setReviewApproved: mocks.set,
}))

const { ConsoleApp } = await import('./ConsoleApp')

function review(over: Partial<Review> = {}): Review {
  return {
    id: 'r1', name: 'Ben Cruz', venue: 'E2E Padel Club', quote: 'Booking took me one minute.', role: 'player', rating: 5,
    approved: false, consented_at: '2030-01-01T00:00:00Z', created_at: '2030-01-02T00:00:00Z', ...over,
  }
}
const pad = (n: number) => String(n).padStart(3, '0')
function manyReviews(count: number): Review[] {
  return Array.from({ length: count }, (_, i) => review({ id: `r${pad(i + 1)}`, name: `E2E Reviewer ${pad(i + 1)}`, quote: `Quote number ${i + 1}`, approved: (i + 1) % 2 === 0 }))
}
function servePages(all: Review[]) {
  mocks.reviews.mockImplementation(async ({ approved, search, page }) => {
    const rows = all.filter((r) => (approved === 'all' || r.approved === (approved === 'approved')) && r.name.toLowerCase().includes(search.toLowerCase()))
    return { rows: rows.slice((page - 1) * 25, page * 25), total: rows.length } satisfies Page<Review>
  })
}

function Probe() {
  const location = useLocation()
  const navigate = useNavigate()
  return <div><div data-testid="location">{location.pathname + location.search}</div><button type="button" onClick={() => void navigate(-1)}>history back</button></div>
}
function renderAt(path = '/reviews') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}><AuthContext.Provider value={authState('admin')}>
      <MemoryRouter initialEntries={[path]}><ConsoleApp /><Probe /></MemoryRouter>
    </AuthContext.Provider></QueryClientProvider>,
  )
}
const params = () => new URL(screen.getByTestId('location').textContent ?? '', 'http://x').searchParams
const names = () => screen.queryAllByText(/^E2E Reviewer \d{3}$/).map((e) => e.textContent)
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
  mocks.reviews.mockReset()
  mocks.set.mockReset().mockResolvedValue(undefined)
})

describe('Reviews page states (was ReviewsInbox)', () => {
  it('has a Reviews h1', async () => {
    mocks.reviews.mockReturnValue(new Promise(() => {}))
    renderAt()
    expect(await screen.findByRole('heading', { level: 1, name: 'Reviews' })).toBeInTheDocument()
  })

  it('shows a loading state', async () => {
    mocks.reviews.mockReturnValue(new Promise(() => {}))
    renderAt()
    expect(await screen.findByText(/Loading reviews/)).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    mocks.reviews.mockResolvedValue({ rows: [], total: 0 })
    renderAt()
    expect(await screen.findByText('No reviews yet.')).toBeInTheDocument()
  })

  it('shows a filtered-empty message (not "No reviews yet.") when the filter matches nothing', async () => {
    servePages(manyReviews(3).filter((r) => !r.approved))
    renderAt('/reviews?status=approved')
    expect(await screen.findByText(/no reviews/i)).toBeInTheDocument()
    expect(screen.queryByText('No reviews yet.')).not.toBeInTheDocument()
  })

  it('shows an error state with Retry', async () => {
    mocks.reviews.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ rows: [review()], total: 1 })
    renderAt()
    expect(await screen.findByText("Couldn't load reviews.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/Ben Cruz/)).toBeInTheDocument()
  })
})

describe('Reviews rows and detail panel', () => {
  it('lists compact rows with name, rating and status; the approve/hide action lives in the panel', async () => {
    mocks.reviews.mockResolvedValue({ rows: [
      review(),
      review({ id: 'r2', name: 'Ana Reyes', venue: null, role: 'owner', rating: 3, quote: 'Members book on their own now.', approved: true }),
    ], total: 2 })
    renderAt()
    const first = (await screen.findByText(/Ben Cruz/)).closest('li')!
    expect(within(first).getByText('Hidden')).toBeInTheDocument()
    expect(within(first).getByText(/5/)).toBeInTheDocument()
    const second = screen.getByText(/Ana Reyes/).closest('li')!
    expect(within(second).getByText('Approved')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument()
  })

  it('shows name, role, venue, rating and the full quote in the panel; a hidden review offers Approve', async () => {
    mocks.reviews.mockResolvedValue({ rows: [review()], total: 1 })
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: /^(?=.*details)(?=.*Ben Cruz)/i }))
    const panel = await panelFor('Ben Cruz')
    expect(params().get('open')).toBe('r1')
    expect(within(panel).getByText(/player/i)).toBeInTheDocument()
    expect(within(panel).getByText(/E2E Padel Club/)).toBeInTheDocument()
    expect(within(panel).getByText(/5/)).toBeInTheDocument()
    expect(within(panel).getByText(/Booking took me one minute\./)).toBeInTheDocument()
    expect(within(panel).getByText('Hidden')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument()
  })

  it('an approved review offers Hide and not Approve', async () => {
    mocks.reviews.mockResolvedValue({ rows: [review({ id: 'r2', name: 'Ana Reyes', venue: null, role: 'owner', rating: 3, approved: true })], total: 1 })
    renderAt('/reviews?open=r2')
    const panel = await panelFor('Ana Reyes')
    expect(within(panel).getByText(/owner/i)).toBeInTheDocument()
    expect(within(panel).getByText('Approved')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Hide' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('Approve calls setReviewApproved(id, true) and reloads the page', async () => {
    mocks.reviews.mockResolvedValue({ rows: [review()], total: 1 })
    renderAt('/reviews?open=r1')
    const panel = await panelFor('Ben Cruz')
    await userEvent.click(within(panel).getByRole('button', { name: 'Approve' }))
    expect(mocks.set).toHaveBeenCalledWith('r1', true)
    await waitFor(() => expect(mocks.reviews).toHaveBeenCalledTimes(2))
  })

  it('Hide calls setReviewApproved(id, false)', async () => {
    mocks.reviews.mockResolvedValue({ rows: [review({ approved: true })], total: 1 })
    renderAt('/reviews?open=r1')
    const panel = await panelFor('Ben Cruz')
    await userEvent.click(within(panel).getByRole('button', { name: 'Hide' }))
    expect(mocks.set).toHaveBeenCalledWith('r1', false)
  })

  it('shows an alert when the change fails', async () => {
    mocks.reviews.mockResolvedValue({ rows: [review()], total: 1 })
    mocks.set.mockRejectedValue(new Error('permission denied'))
    renderAt('/reviews?open=r1')
    const panel = await panelFor('Ben Cruz')
    await userEvent.click(within(panel).getByRole('button', { name: 'Approve' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('permission denied')
  })
})

describe('Reviews filtering, paging and URL state', () => {
  it('fetches the first bounded page with the default filters', async () => {
    servePages(manyReviews(60))
    renderAt()
    await screen.findByText('E2E Reviewer 001')
    expect(mocks.reviews).toHaveBeenCalledWith({ approved: 'all', search: '', page: 1 })
    expect(names()).toHaveLength(25)
  })

  it('offers All, Approved and Hidden under "Filter by status" and maps them to ?status=', async () => {
    servePages(manyReviews(60))
    renderAt()
    const filter = await screen.findByLabelText('Filter by status')
    expect(within(filter).getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'Approved', 'Hidden'])
    await userEvent.selectOptions(filter, 'hidden')
    await waitFor(() => expect(mocks.reviews).toHaveBeenLastCalledWith({ approved: 'hidden', search: '', page: 1 }))
    expect(params().get('status')).toBe('hidden')
  })

  it('pages through 60 reviews with no dropped or duplicated row and resets the page on a filter change', async () => {
    servePages(manyReviews(60))
    renderAt()
    await screen.findByText('E2E Reviewer 001')
    const seen: (string | null)[] = [...names()]
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('E2E Reviewer 026')
    seen.push(...names())
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('E2E Reviewer 051')
    seen.push(...names())
    expect(screen.getByText(/Showing 51\s*[–-]\s*60 of 60/)).toBeInTheDocument()
    expect(seen).toEqual(manyReviews(60).map((r) => r.name))
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'approved')
    await waitFor(() => expect(mocks.reviews).toHaveBeenLastCalledWith({ approved: 'approved', search: '', page: 1 }))
    expect(params().get('page') ?? '1').toBe('1')
    for (const [input] of mocks.reviews.mock.calls) expect(Object.keys(input).sort()).toEqual(['approved', 'page', 'search'])
  })

  it('searching resets the page and writes ?q=', async () => {
    servePages(manyReviews(60))
    renderAt('/reviews?page=2')
    await screen.findByText('E2E Reviewer 026')
    await userEvent.type(screen.getByLabelText(/search/i), 'Reviewer 05')
    await waitFor(() => expect(mocks.reviews).toHaveBeenLastCalledWith({ approved: 'all', search: 'Reviewer 05', page: 1 }), { timeout: 3000 })
    expect(params().get('q')).toBe('Reviewer 05')
  })

  it('restores status, search and page from the URL on a fresh load, and back navigation works', async () => {
    servePages(manyReviews(60))
    renderAt('/reviews?status=approved&q=Reviewer&page=1')
    await waitFor(() => expect(mocks.reviews).toHaveBeenCalledWith({ approved: 'approved', search: 'Reviewer', page: 1 }))
    expect(screen.getByLabelText('Filter by status')).toHaveValue('approved')
    expect(screen.getByLabelText(/search/i)).toHaveValue('Reviewer')
    await screen.findByText('E2E Reviewer 002')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(mocks.reviews).toHaveBeenLastCalledWith({ approved: 'approved', search: 'Reviewer', page: 2 }))
    await userEvent.click(screen.getByRole('button', { name: 'history back' }))
    await waitFor(() => expect(mocks.reviews).toHaveBeenLastCalledWith({ approved: 'approved', search: 'Reviewer', page: 1 }))
  })
})
