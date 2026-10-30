import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { fetchVenueSettings, updateVenueSettings, type Sport, type VenueSettings } from '../catalog/api'
import { useVenueSettings } from '../catalog/hooks'
import { SportOrderSection } from './SportOrderSection'
import { menuMove, openMoveMenu } from '../../test/reorder'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchVenueSettings: vi.fn(),
  updateVenueSettings: vi.fn(),
}))

const ORDER: Sport[] = ['badminton', 'pickleball', 'basketball', 'tennis']
const settings = (sport_order: Sport[]) => ({ venue_id: 'v1', name: 'Claudex Courts', sport_order }) as VenueSettings

/** Like SettingsPage: the section gets the cached settings, so it re-renders when they change. */
function Harness() {
  const s = useVenueSettings()
  return s.data ? <SportOrderSection settings={s.data} /> : null
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>)
}

const order = () =>
  within(screen.getByRole('list')).getAllByRole('listitem').map((li) => li.firstChild?.textContent)

describe('SportOrderSection', () => {
  beforeEach(() => {
    vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue(settings(ORDER))
    vi.mocked(updateVenueSettings).mockReset().mockImplementation(async (v) => settings(v.sport_order!))
  })

  it('lists every sport in the venue order, with the edges disabled', async () => {
    renderSection()
    expect(await screen.findByRole('heading', { name: 'Sport order' })).toBeInTheDocument()
    expect(order()).toEqual(['Badminton', 'Pickleball', 'Basketball', 'Tennis'])
    expect((await openMoveMenu('Badminton')).getByRole('button', { name: 'Move up' })).toBeDisabled()
    expect((await openMoveMenu('Tennis')).getByRole('button', { name: 'Move down' })).toBeDisabled()
    expect((await openMoveMenu('Pickleball')).getByRole('button', { name: 'Move up' })).toBeEnabled()
  })

  it('saves the new order right away and shows it', async () => {
    renderSection()
    await menuMove('Tennis', 'Move up')
    expect(updateVenueSettings).toHaveBeenCalledWith({ sport_order: ['badminton', 'pickleball', 'tennis', 'basketball'] })
    expect(order()).toEqual(['Badminton', 'Pickleball', 'Tennis', 'Basketball'])
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reorder Tennis' })).toHaveFocus()
  })

  it('keeps two quick moves in order: saved one at a time, no jumping back, focus kept', async () => {
    const pending: (() => void)[] = []
    vi.mocked(updateVenueSettings).mockImplementation(
      (v) => new Promise((resolve) => pending.push(() => resolve(settings(v.sport_order!)))),
    )
    renderSection()
    await menuMove('Tennis', 'Move up')
    await menuMove('Tennis', 'Move up')
    expect(order()).toEqual(['Badminton', 'Tennis', 'Pickleball', 'Basketball'])
    expect(updateVenueSettings).toHaveBeenCalledTimes(1) // the second save waits for the first

    pending[0]() // the first save returns the older order…
    await vi.waitFor(() => expect(updateVenueSettings).toHaveBeenCalledTimes(2))
    expect(order()).toEqual(['Badminton', 'Tennis', 'Pickleball', 'Basketball']) // …which doesn't overwrite the newer one
    expect(screen.getByRole('button', { name: 'Reorder Tennis' })).toHaveFocus()

    pending[1]()
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(vi.mocked(updateVenueSettings).mock.calls.map(([v]) => v.sport_order)).toEqual([
      ['badminton', 'pickleball', 'tennis', 'basketball'],
      ['badminton', 'tennis', 'pickleball', 'basketball'],
    ])
    expect(order()).toEqual(['Badminton', 'Tennis', 'Pickleball', 'Basketball'])
  })

  it('puts the order back and shows the error when saving fails', async () => {
    vi.mocked(updateVenueSettings).mockRejectedValue(new ApiError('You do not have permission to do that.', '42501'))
    renderSection()
    await menuMove('Tennis', 'Move up')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(order()).toEqual(['Badminton', 'Pickleball', 'Basketball', 'Tennis'])
  })
})
