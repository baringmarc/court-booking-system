import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_STORAGE_KEY } from '../../lib/themes'
import { fetchVenueSettings, type VenueSettings } from './api'
import { ThemeSync } from './ThemeSync'

vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<typeof import('./api')>()), fetchVenueSettings: vi.fn() }))

const store = new Map<string, string>()
const settings = (theme: string) => ({ venue_id: 'v1', name: 'Claudex Courts', theme }) as VenueSettings

function renderSync() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ThemeSync /></QueryClientProvider>)
}

describe('ThemeSync', () => {
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    delete document.documentElement.dataset.theme
  })
  afterEach(() => vi.unstubAllGlobals())

  it("applies and caches the venue's preset once settings load", async () => {
    vi.mocked(fetchVenueSettings).mockResolvedValue(settings('sunset'))
    renderSync()
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('sunset'))
    expect(store.get(THEME_STORAGE_KEY)).toBe('sunset')
  })

  it('replaces a stale cached preset with the default', async () => {
    document.documentElement.dataset.theme = 'ocean'
    vi.mocked(fetchVenueSettings).mockResolvedValue(settings('plotline'))
    renderSync()
    await waitFor(() => expect(store.get(THEME_STORAGE_KEY)).toBe('plotline'))
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('keeps the cached preset while settings load or fail', async () => {
    document.documentElement.dataset.theme = 'plum'
    vi.mocked(fetchVenueSettings).mockRejectedValue(new Error('offline'))
    renderSync()
    await waitFor(() => expect(fetchVenueSettings).toHaveBeenCalled())
    expect(document.documentElement.dataset.theme).toBe('plum')
  })
})
