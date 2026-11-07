import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { fetchCourts, fetchVenueSettings, type Court, type CourtWithPhotos, type VenueSettings } from '../catalog/api'
import { reorderCourts } from './api'
import { menuMove, openMoveMenu } from '../../test/reorder'
import { CourtsPage } from './CourtsPage'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourts: vi.fn(),
  fetchVenueSettings: vi.fn(),
}))
vi.mock('./api', () => ({ reorderCourts: vi.fn() }))

const court = (id: string, name: string, sport: Court['sport'], sort_order: number, is_active = true) =>
  ({ id, name, sport, sort_order, is_active, default_hourly_rate: 350, court_photos: [] as CourtWithPhotos['court_photos'] }) as CourtWithPhotos
// As fetchCourts returns them (tennis first in this venue); the archived court b9 sorts last in its sport.
const courts = [
  court('t1', 'Tennis Court', 'tennis', 0),
  court('b1', 'Badminton 1', 'badminton', 0),
  court('b2', 'Badminton 2', 'badminton', 1),
  court('b3', 'Badminton 3', 'badminton', 2),
  court('b9', 'Badminton 9', 'badminton', 3, false),
]

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><CourtsPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const rowNames = (sport: string) =>
  within(screen.getByRole('region', { name: sport })).getAllByRole('listitem').map((li) => within(li).getByRole('strong', { hidden: true }).textContent)

describe('CourtsPage ordering', () => {
  beforeEach(() => {
    vi.mocked(fetchCourts).mockReset().mockResolvedValue(courts)
    vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ currency: 'PHP' } as VenueSettings)
    vi.mocked(reorderCourts).mockReset().mockResolvedValue()
  })

  it('groups courts by sport in display order, archived ones after the active ones', async () => {
    renderPage()
    const headings = await screen.findAllByRole('heading', { level: 2 })
    expect(headings.map((h) => h.textContent)).toEqual(['Tennis', 'Badminton'])
    expect(rowNames('Badminton')).toEqual(['Badminton 1', 'Badminton 2', 'Badminton 3', 'Badminton 9'])
    expect(within(screen.getByRole('region', { name: 'Badminton' })).getByText('Archived')).toBeInTheDocument()
  })

  it('is titled Courts, with a count of active and archived courts (T17.30)', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Courts' })).toBeInTheDocument()
    expect(await screen.findByText('4 active · 1 archived')).toBeInTheDocument()
  })

  it('shows only the active count when nothing is archived (T17.30)', async () => {
    vi.mocked(fetchCourts).mockResolvedValue(courts.slice(0, 4))
    renderPage()
    expect(await screen.findByText('4 active')).toBeInTheDocument()
    expect(screen.queryByText(/archived/i)).not.toBeInTheDocument()
  })

  it('badges active courts Active; an archived one is listed after them, linked, with its rate, and is not sortable (T17.30)', async () => {
    renderPage()
    const region = await screen.findByRole('region', { name: 'Badminton' })
    expect(within(region).getAllByText('Active')).toHaveLength(3)
    const link = within(region).getByRole('link', { name: /Badminton 9/ })
    expect(link).toHaveAttribute('href', '/admin/courts/b9')
    expect(link).toHaveTextContent('Archived')
    expect(link).toHaveTextContent(/350.*\/hr/)
    expect(link.closest('.is-archived')).not.toBeNull()
    expect(within(region).getByRole('link', { name: /Badminton 1/ }).closest('.is-archived')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reorder Badminton 9' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reorder Badminton 1' })).toBeInTheDocument()
  })

  it('has a reorder handle per active court whose menu stops at the edges of the active courts', async () => {
    renderPage()
    let menu = await openMoveMenu('Badminton 1')
    expect(menu.getByRole('button', { name: 'Move up' })).toBeDisabled()
    expect(menu.getByRole('button', { name: 'Move to top' })).toBeDisabled()
    expect(menu.getByRole('button', { name: 'Move down' })).toBeEnabled()
    menu = await openMoveMenu('Badminton 3')
    expect(menu.getByRole('button', { name: 'Move to bottom' })).toBeDisabled()
    expect(menu.getByRole('button', { name: 'Move down' })).toBeDisabled()
    // A sport with one court can't move at all.
    menu = await openMoveMenu('Tennis Court')
    for (const name of ['Move up', 'Move down', 'Move to top', 'Move to bottom']) expect(menu.getByRole('button', { name })).toBeDisabled()
  })

  it('moves a court at once, saves the whole order with archived courts last, and keeps focus on its handle', async () => {
    // After the save, the refetch returns the server's new order.
    const moved = [courts[0], { ...courts[3], sort_order: 0 }, { ...courts[1], sort_order: 1 }, { ...courts[2], sort_order: 2 }, courts[4]]
    vi.mocked(fetchCourts).mockResolvedValueOnce(courts).mockResolvedValue(moved)
    renderPage()
    await menuMove('Badminton 3', 'Move to top')
    expect(reorderCourts).toHaveBeenCalledWith('badminton', ['b3', 'b1', 'b2', 'b9'])
    expect(rowNames('Badminton')).toEqual(['Badminton 3', 'Badminton 1', 'Badminton 2', 'Badminton 9'])
    expect(screen.getByRole('button', { name: 'Reorder Badminton 3' })).toHaveFocus()
  })

  it('keeps two quick moves in order: saved one at a time, no jumping back', async () => {
    const pending: (() => void)[] = []
    vi.mocked(reorderCourts).mockImplementation(() => new Promise<void>((resolve) => pending.push(resolve)))
    const final = [courts[0], { ...courts[3], sort_order: 0 }, { ...courts[1], sort_order: 1 }, { ...courts[2], sort_order: 2 }, courts[4]]
    // Only the last move refetches, and by then the server has both moves.
    vi.mocked(fetchCourts).mockResolvedValueOnce(courts).mockResolvedValue(final)
    renderPage()

    await menuMove('Badminton 3', 'Move up')
    await menuMove('Badminton 3', 'Move up')
    expect(rowNames('Badminton')).toEqual(['Badminton 3', 'Badminton 1', 'Badminton 2', 'Badminton 9'])
    expect(reorderCourts).toHaveBeenCalledTimes(1) // the second save waits for the first

    pending[0]()
    await vi.waitFor(() => expect(reorderCourts).toHaveBeenCalledTimes(2))
    expect(reorderCourts).toHaveBeenLastCalledWith('badminton', ['b3', 'b1', 'b2', 'b9'])
    expect(rowNames('Badminton')).toEqual(['Badminton 3', 'Badminton 1', 'Badminton 2', 'Badminton 9']) // no refetch of the older order
    pending[1]()
    await vi.waitFor(() => expect(fetchCourts).toHaveBeenCalledTimes(2)) // one refetch, after the last move
    expect(rowNames('Badminton')).toEqual(['Badminton 3', 'Badminton 1', 'Badminton 2', 'Badminton 9'])
  })

  it('puts the order back and says why when the save fails', async () => {
    vi.mocked(reorderCourts).mockRejectedValue(new ApiError('Only staff can reorder courts.', 'P0001', 'forbidden'))
    renderPage()
    await menuMove('Badminton 2', 'Move up')
    expect(await screen.findByText('Only staff can reorder courts.')).toBeInTheDocument()
    expect(rowNames('Badminton')).toEqual(['Badminton 1', 'Badminton 2', 'Badminton 3', 'Badminton 9'])
  })
})
