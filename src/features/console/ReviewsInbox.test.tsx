// T15.4: the console lists reviews and lets a platform admin approve or hide each one.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Review } from './api'

vi.mock('./api', () => ({ fetchReviews: vi.fn(), setReviewApproved: vi.fn() }))

const { fetchReviews, setReviewApproved } = await import('./api')
const { ReviewsInbox } = await import('./ReviewsInbox')

function review(over: Partial<Review> = {}): Review {
  return {
    id: 'r1', name: 'Ben Cruz', venue: 'E2E Padel Club', quote: 'Booking took me one minute.', role: 'player', rating: 5,
    approved: false, consented_at: '2030-01-01T00:00:00Z', created_at: '2030-01-02T00:00:00Z', ...over,
  }
}

function renderInbox() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ReviewsInbox /></QueryClientProvider>)
}

beforeEach(() => {
  vi.mocked(fetchReviews).mockReset()
  vi.mocked(setReviewApproved).mockReset()
  vi.mocked(setReviewApproved).mockResolvedValue(undefined)
})

describe('ReviewsInbox', () => {
  it('has a Reviews heading with id reviews-heading', () => {
    vi.mocked(fetchReviews).mockReturnValue(new Promise(() => {}))
    renderInbox()
    const h = screen.getByRole('heading', { name: 'Reviews' })
    expect(h).toHaveAttribute('id', 'reviews-heading')
  })

  it('shows a loading state', () => {
    vi.mocked(fetchReviews).mockReturnValue(new Promise(() => {}))
    renderInbox()
    expect(screen.getByText(/Loading reviews/)).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    vi.mocked(fetchReviews).mockResolvedValue([])
    renderInbox()
    expect(await screen.findByText('No reviews yet.')).toBeInTheDocument()
  })

  it('shows an error state with Retry', async () => {
    vi.mocked(fetchReviews).mockRejectedValueOnce(new Error('boom')).mockResolvedValue([review()])
    renderInbox()
    expect(await screen.findByText("Couldn't load reviews.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/Booking took me one minute\./)).toBeInTheDocument()
  })

  it('lists name, role, venue, rating, quote and status; a hidden review offers Approve', async () => {
    vi.mocked(fetchReviews).mockResolvedValue([
      review(),
      review({ id: 'r2', name: 'Ana Reyes', venue: null, role: 'owner', rating: 3, quote: 'Members book on their own now.', approved: true }),
    ])
    renderInbox()
    await screen.findByText(/Booking took me one minute\./)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    const first = within(items[0])
    expect(first.getByText(/Ben Cruz/)).toBeInTheDocument()
    expect(first.getByText(/player/i)).toBeInTheDocument()
    expect(first.getByText(/E2E Padel Club/)).toBeInTheDocument()
    expect(first.getByText(/5/)).toBeInTheDocument()
    expect(first.getByText('Hidden')).toBeInTheDocument()
    expect(first.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(first.queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument()
    const second = within(items[1])
    expect(second.getByText(/Ana Reyes/)).toBeInTheDocument()
    expect(second.getByText(/owner/i)).toBeInTheDocument()
    expect(second.getByText('Approved')).toBeInTheDocument()
    expect(second.getByRole('button', { name: 'Hide' })).toBeInTheDocument()
    expect(second.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('Approve calls setReviewApproved(id, true) and reloads the list', async () => {
    vi.mocked(fetchReviews).mockResolvedValue([review()])
    renderInbox()
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(setReviewApproved).toHaveBeenCalledWith('r1', true)
    await vi.waitFor(() => expect(fetchReviews).toHaveBeenCalledTimes(2))
  })

  it('Hide calls setReviewApproved(id, false)', async () => {
    vi.mocked(fetchReviews).mockResolvedValue([review({ approved: true })])
    renderInbox()
    await userEvent.click(await screen.findByRole('button', { name: 'Hide' }))
    expect(setReviewApproved).toHaveBeenCalledWith('r1', false)
  })
})
