import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { catalogKeys, fetchVenueSettings, type VenueSettings } from './api'
import { HomeBanner } from './HomeBanner'

vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchVenueSettings: vi.fn() }))
vi.mock('./media', () => ({ mediaUrl: (path: string) => `https://cdn.test/${path}` }))

const PATH = 'banner/11111111-1111-1111-1111-111111111111.webp'
const settings = (banner_path: string | null, banner_alt: string | null) =>
  ({ venue_id: 'v1', name: 'Claudex Courts', banner_path, banner_alt }) as VenueSettings

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { container } = render(
    <QueryClientProvider client={client}>
      <HomeBanner />
    </QueryClientProvider>,
  )
  /** Resolves once the settings query has finished with `status`. */
  const settled = (status: 'success' | 'error') =>
    waitFor(() => expect(client.getQueryState(catalogKeys.settings)?.status).toBe(status))
  return { container, settled }
}

describe('HomeBanner', () => {
  beforeEach(() => {
    vi.mocked(fetchVenueSettings).mockReset()
  })

  it('shows the banner image with its alt text when one is set', async () => {
    vi.mocked(fetchVenueSettings).mockResolvedValue(settings(PATH, 'Night games on court 1'))
    renderBanner()
    const img = await screen.findByRole('img', { name: 'Night games on court 1' })
    expect(img).toHaveAttribute('src', `https://cdn.test/${PATH}`)
    // Above the fold: loaded eagerly, with dimensions reserved so it can't shift the page as it loads.
    expect(img).not.toHaveAttribute('loading')
    expect(img).toHaveAttribute('width', '2200')
    expect(img).toHaveAttribute('height', '733')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('opens the whole banner full screen when tapped', async () => {
    vi.mocked(fetchVenueSettings).mockResolvedValue(settings(PATH, 'Night games on court 1'))
    renderBanner()
    await userEvent.click(await screen.findByRole('button', { name: 'View full screen: Night games on court 1' }))
    const viewer = screen.getByRole('dialog', { name: 'Banner photo' })
    expect(within(viewer).getByRole('img', { name: 'Night games on court 1' })).toHaveAttribute('src', `https://cdn.test/${PATH}`)
    await userEvent.click(within(viewer).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders nothing when no banner is set', async () => {
    vi.mocked(fetchVenueSettings).mockResolvedValue(settings(null, null))
    const { container, settled } = renderBanner()
    await settled('success')
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while settings load', () => {
    vi.mocked(fetchVenueSettings).mockReturnValue(new Promise(() => {}))
    expect(renderBanner().container).toBeEmptyDOMElement()
  })

  it('renders nothing when settings fail to load', async () => {
    vi.mocked(fetchVenueSettings).mockRejectedValue(new Error('network down'))
    const { container, settled } = renderBanner()
    await settled('error')
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('removes itself if the image fails to load (never a broken image)', async () => {
    vi.mocked(fetchVenueSettings).mockResolvedValue(settings(PATH, 'Night games on court 1'))
    const { container } = renderBanner()
    fireEvent.error(await screen.findByRole('img', { name: 'Night games on court 1' }))
    expect(container).toBeEmptyDOMElement()
  })
})
