import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'
import { catalogKeys, type VenueSettings } from '../catalog/api'
import { fetchVenueSettings } from '../catalog/api'
import { VenueTitleSync } from './VenueTitleSync'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../catalog/api')>()),
  fetchVenueSettings: vi.fn(),
}))

const nameRow = (name: string) => ({ venue_id: 'venue-a', name }) as VenueSettings
const fetchSettings = vi.mocked(fetchVenueSettings)

function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const view = render(<QueryClientProvider client={client}><VenueTitleSync /></QueryClientProvider>)
  return { ...view, client }
}

beforeEach(() => {
  setCurrentVenue({ id: 'venue-a', slug: 'forty-degrees', status: 'active' })
  document.title = 'Plotline'
  fetchSettings.mockReset()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('VenueTitleSync', () => {
  it('keeps Plotline while venue settings are pending', () => {
    fetchSettings.mockReturnValue(new Promise(() => {}))
    mount()
    expect(document.title).toBe('Plotline')
  })

  it('uses venue_settings.name when settings resolve, without a demo venue title', async () => {
    fetchSettings.mockResolvedValue(nameRow('Forty Degrees'))
    mount()
    await waitFor(() => expect(document.title).toBe('Forty Degrees'))
    expect(document.title).not.toContain('Claudex Courts')
  })

  it('updates the title when the settings name changes in the venue query cache', async () => {
    fetchSettings.mockResolvedValue(nameRow('Forty Degrees'))
    const { client } = mount()
    await waitFor(() => expect(document.title).toBe('Forty Degrees'))
    client.setQueryData(catalogKeys.settings(), nameRow('Forty Degrees Sports'))
    await waitFor(() => expect(document.title).toBe('Forty Degrees Sports'))
  })

  it('uses the neutral title when settings fail', async () => {
    fetchSettings.mockRejectedValue(new Error('offline'))
    mount()
    await waitFor(() => expect(fetchSettings).toHaveBeenCalled())
    expect(document.title).toBe('Plotline')
  })

  it('returns to the neutral title when the venue boundary unmounts', async () => {
    fetchSettings.mockResolvedValue(nameRow('Forty Degrees'))
    const { unmount } = mount()
    await waitFor(() => expect(document.title).toBe('Forty Degrees'))
    unmount()
    expect(document.title).toBe('Plotline')
  })
})
