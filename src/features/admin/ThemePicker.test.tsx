import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { THEME_STORAGE_KEY } from '../../lib/themes'
import { updateVenueSettings, type VenueSettings } from '../catalog/api'
import { ThemePicker } from './ThemePicker'

vi.mock('../catalog/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../catalog/api')>()), updateVenueSettings: vi.fn() }))

const settings = (theme = 'plotline') => ({ venue_id: 'v1', name: 'Claudex Courts', theme }) as VenueSettings
const store = new Map<string, string>()

function renderPicker(s: VenueSettings) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ThemePicker settings={s} />
    </QueryClientProvider>,
  )
}

const card = (name: string) => screen.getByRole('button', { name })

describe('ThemePicker', () => {
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    vi.mocked(updateVenueSettings).mockReset()
    delete document.documentElement.dataset.theme
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows every preset, with the saved one pressed', () => {
    renderPicker(settings('ocean'))
    for (const name of ['Plotline', 'Court Green', 'Ocean', 'Plum', 'Sunset']) expect(card(name)).toBeInTheDocument()
    expect(card('Ocean')).toHaveAttribute('aria-pressed', 'true')
    expect(card('Plotline')).toHaveAttribute('aria-pressed', 'false')
  })

  it('saves a preset, applies it at once and remembers it', async () => {
    vi.mocked(updateVenueSettings).mockResolvedValue(settings('plum'))
    renderPicker(settings())
    await userEvent.click(card('Plum'))
    expect(updateVenueSettings).toHaveBeenCalledWith({ theme: 'plum' })
    expect(document.documentElement.dataset.theme).toBe('plum')
    expect(store.get(THEME_STORAGE_KEY)).toBe('plum')
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
  })

  it('marks the group busy and the new pick pressed while saving, ignoring other taps', async () => {
    let resolve: (s: VenueSettings) => void = () => {}
    vi.mocked(updateVenueSettings).mockImplementation(() => new Promise((r) => { resolve = r }))
    renderPicker(settings())
    await userEvent.click(card('Sunset'))
    expect(screen.getByRole('group')).toHaveAttribute('aria-busy', 'true')
    expect(card('Sunset')).toHaveAttribute('aria-pressed', 'true')
    expect(card('Sunset')).toHaveFocus()
    await userEvent.click(card('Ocean'))
    expect(updateVenueSettings).toHaveBeenCalledTimes(1)
    resolve(settings('sunset'))
    await waitFor(() => expect(screen.getByRole('group')).toHaveAttribute('aria-busy', 'false'))
  })

  it('goes back to the saved preset and says why when the save fails', async () => {
    vi.mocked(updateVenueSettings).mockRejectedValue(new ApiError('permission denied for table venue_settings', '42501'))
    document.documentElement.dataset.theme = 'ocean'
    renderPicker(settings('ocean'))
    await userEvent.click(card('Plotline'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('ocean')
    expect(store.get(THEME_STORAGE_KEY)).toBe('ocean')
    expect(card('Ocean')).toHaveAttribute('aria-pressed', 'true')
  })

  it('picking the default removes the attribute', async () => {
    vi.mocked(updateVenueSettings).mockResolvedValue(settings('plotline'))
    document.documentElement.dataset.theme = 'plum'
    renderPicker(settings('plum'))
    await userEvent.click(card('Plotline'))
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })
})
