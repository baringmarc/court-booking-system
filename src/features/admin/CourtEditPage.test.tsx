import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCourt, fetchCourtRates, fetchCourts, fetchOperatingHours, fetchVenueSettings, saveCourt,
  type Court, type VenueSettings,
} from '../catalog/api'
import { CourtEditPage } from './CourtEditPage'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourt: vi.fn(),
  fetchCourts: vi.fn(),
  fetchCourtRates: vi.fn(),
  fetchOperatingHours: vi.fn(),
  fetchVenueSettings: vi.fn(),
  saveCourt: vi.fn(),
}))
vi.mock('../catalog/media', () => ({ mediaUrl: (path: string) => `https://cdn.test/${path}` }))

const court = (id: string, name: string, sport: Court['sport'], sort_order: number) =>
  ({ id, name, sport, sort_order, is_active: true, default_hourly_rate: 350, description: '', photo_path: null }) as Court
const courts = [court('b1', 'Badminton 1', 'badminton', 0), court('b2', 'Badminton 2', 'badminton', 4), court('t1', 'Tennis Court', 'tennis', 0)]

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/admin/courts/:id" element={<CourtEditPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CourtEditPage order', () => {
  beforeEach(() => {
    vi.mocked(fetchCourts).mockReset().mockResolvedValue(courts)
    vi.mocked(fetchCourt).mockReset().mockResolvedValue(courts[1])
    vi.mocked(fetchCourtRates).mockReset().mockResolvedValue([])
    vi.mocked(fetchOperatingHours).mockReset().mockResolvedValue([])
    vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ currency: 'PHP' } as VenueSettings)
    vi.mocked(saveCourt).mockReset().mockImplementation(async (id) => ({ ...courts[1], id: id ?? 'new-court' }))
  })

  it('has no order number field: order is set with the arrows on the courts list', async () => {
    renderAt('/admin/courts/new')
    expect(await screen.findByLabelText('Name')).toBeInTheDocument()
    expect(screen.queryByLabelText('Display order')).not.toBeInTheDocument()
  })

  it('puts a new court last in its sport', async () => {
    renderAt('/admin/courts/new')
    await screen.findByLabelText('Name')
    await vi.waitFor(() => expect(fetchCourts).toHaveBeenCalled())
    await userEvent.type(screen.getByLabelText('Name'), 'Badminton 3')
    await userEvent.selectOptions(screen.getByLabelText('Sport'), 'badminton')
    await userEvent.type(screen.getByLabelText('Default hourly rate'), '350')
    await userEvent.click(screen.getByRole('button', { name: 'Create court' }))
    expect(saveCourt).toHaveBeenCalledWith(null, expect.objectContaining({ name: 'Badminton 3', sport: 'badminton', sort_order: 5 }))
  })

  it('waits for the courts list before creating, so the new court can go last', async () => {
    vi.mocked(fetchCourts).mockReturnValue(new Promise(() => {}))
    renderAt('/admin/courts/new')
    expect(await screen.findByRole('button', { name: 'Create court' })).toBeDisabled()
  })

  it('puts a court moved to another sport last in that sport', async () => {
    renderAt('/admin/courts/b2')
    await screen.findByRole('button', { name: 'Save changes' })
    await vi.waitFor(() => expect(fetchCourts).toHaveBeenCalled())
    await userEvent.selectOptions(screen.getByLabelText('Sport'), 'tennis')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(saveCourt).toHaveBeenCalledWith('b2', expect.objectContaining({ sport: 'tennis', sort_order: 1 }))
  })

  it('keeps an existing court where it is when its details are saved', async () => {
    renderAt('/admin/courts/b2')
    await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }))
    expect(saveCourt).toHaveBeenCalledWith('b2', expect.not.objectContaining({ sort_order: expect.anything() }))
  })
})
