import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { fetchVenueSettings, updateVenueSettings, type Sport, type VenueSettings } from '../catalog/api'
import { useVenueSettings } from '../catalog/hooks'
import { SportOrderSection } from './SportOrderSection'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchVenueSettings: vi.fn(),
  updateVenueSettings: vi.fn(),
}))

const ORDER: Sport[] = ['badminton', 'pickleball', 'basketball', 'tennis']
const settings = (sport_order: Sport[]) => ({ id: true, name: 'Claudex Courts', sport_order }) as VenueSettings

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
    expect(screen.getByRole('button', { name: 'Move Badminton up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Tennis down' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Pickleball up' })).toBeEnabled()
  })

  it('saves the new order right away and shows it', async () => {
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Move Tennis up' }))
    expect(updateVenueSettings).toHaveBeenCalledWith({ sport_order: ['badminton', 'pickleball', 'tennis', 'basketball'] })
    expect(order()).toEqual(['Badminton', 'Pickleball', 'Tennis', 'Basketball'])
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move Tennis up' })).toHaveFocus()
  })

  it('keeps two quick moves in order: saved one at a time, no jumping back, focus kept', async () => {
    const pending: (() => void)[] = []
    vi.mocked(updateVenueSettings).mockImplementation(
      (v) => new Promise((resolve) => pending.push(() => resolve(settings(v.sport_order!)))),
    )
    renderSection()
    const up = await screen.findByRole('button', { name: 'Move Tennis up' })
    await userEvent.click(up)
    await userEvent.click(screen.getByRole('button', { name: 'Move Tennis up' }))
    expect(order()).toEqual(['Badminton', 'Tennis', 'Pickleball', 'Basketball'])
    expect(updateVenueSettings).toHaveBeenCalledTimes(1) // the second save waits for the first

    pending[0]() // the first save returns the older order…
    await vi.waitFor(() => expect(updateVenueSettings).toHaveBeenCalledTimes(2))
    expect(order()).toEqual(['Badminton', 'Tennis', 'Pickleball', 'Basketball']) // …which doesn't overwrite the newer one
    expect(screen.getByRole('button', { name: 'Move Tennis up' })).toHaveFocus()

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
    await userEvent.click(await screen.findByRole('button', { name: 'Move Tennis up' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(order()).toEqual(['Badminton', 'Pickleball', 'Basketball', 'Tennis'])
  })
})
