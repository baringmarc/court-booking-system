import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { deleteCourt } from './api'
import { DeleteCourtSection } from './DeleteCourtSection'

vi.mock('./api', () => ({ deleteCourt: vi.fn() }))

const court = { id: 'c1', name: 'Badminton 5', is_active: true }
const refused = () =>
  new ApiError("This court has bookings, so it can't be deleted. Archive it instead.", 'P0001', 'court_has_bookings')

function renderSection(c = court) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/courts/c1']}>
        <Routes>
          <Route path="/admin/courts/:id" element={<DeleteCourtSection court={c} />} />
          <Route path="/admin/courts" element={<h1>All courts</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('DeleteCourtSection', () => {
  // A block body: a function returned from beforeEach is run as cleanup, which would call the mock again.
  beforeEach(() => {
    vi.mocked(deleteCourt).mockReset().mockResolvedValue()
  })

  it('asks for confirmation, and "Keep court" backs out without deleting', async () => {
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'Delete court' }))
    expect(screen.getByRole('button', { name: 'Yes, delete Badminton 5' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep court' }))
    expect(screen.getByRole('button', { name: 'Delete court' })).toBeInTheDocument()
    expect(deleteCourt).not.toHaveBeenCalled()
  })

  it('deletes the court and goes back to the courts list', async () => {
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'Delete court' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete Badminton 5' }))
    expect(deleteCourt).toHaveBeenCalledWith('c1')
    expect(await screen.findByRole('heading', { name: 'All courts' })).toBeInTheDocument()
  })

  it('explains a refusal for a booked court and points to archiving', async () => {
    vi.mocked(deleteCourt).mockRejectedValue(refused())
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'Delete court' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete Badminton 5' }))
    expect(await screen.findByText(/has bookings, so it can't be deleted/)).toBeInTheDocument()
    expect(screen.getByText(/uncheck “Active” in Details above and save/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'All courts' })).not.toBeInTheDocument()
  })

  it('does not repeat the archive tip for a court that is already archived', async () => {
    vi.mocked(deleteCourt).mockRejectedValue(refused())
    renderSection({ ...court, is_active: false })
    await userEvent.click(screen.getByRole('button', { name: 'Delete court' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete Badminton 5' }))
    expect(await screen.findByText(/has bookings, so it can't be deleted/)).toBeInTheDocument()
    expect(screen.queryByText(/above and save/)).not.toBeInTheDocument()
  })
})
