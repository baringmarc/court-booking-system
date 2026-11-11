// T22.1: /book?sport=<sport> opens that sport's tab; an unknown value falls back to the first sport.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCourts, fetchPublicSchedule, fetchVenueSettings, type CourtWithPhotos, type VenueSettings,
} from '../catalog/api'
import { fetchAvailability } from './api'
import { BookPage } from './BookPage'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourts: vi.fn(),
  fetchPublicSchedule: vi.fn(),
  fetchVenueSettings: vi.fn(),
}))
vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchAvailability: vi.fn() }))

const mk = (id: string, name: string, sport: string) =>
  ({ id, name, sport, description: '', is_active: true, court_photos: [] }) as unknown as CourtWithPhotos

function renderPage(search: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/book${search}`]}><BookPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

async function pressed() {
  const group = await screen.findByRole('group', { name: 'Sport' })
  return within(group).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)
}

describe('BookPage sport param', () => {
  beforeEach(() => {
    vi.mocked(fetchVenueSettings).mockResolvedValue({ timezone: 'Asia/Manila', currency: 'PHP', booking_window_days: 30 } as VenueSettings)
    vi.mocked(fetchCourts).mockResolvedValue([mk('A', 'Badminton 1', 'badminton'), mk('B', 'Pickleball 1', 'pickleball')])
    vi.mocked(fetchPublicSchedule).mockResolvedValue([])
    vi.mocked(fetchAvailability).mockResolvedValue([])
  })

  it('?sport=<second sport> opens that tab', async () => {
    renderPage('?sport=pickleball')
    expect(await pressed()).toEqual(['Pickleball'])
    expect(screen.getByText('About the pickleball courts')).toBeInTheDocument()
  })

  it('an unknown sport value falls back to the first sport', async () => {
    renderPage('?sport=curling')
    expect(await pressed()).toEqual(['Badminton'])
  })

  it('no sport param opens the first sport', async () => {
    renderPage('')
    expect(await pressed()).toEqual(['Badminton'])
  })
})
