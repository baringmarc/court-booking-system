import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import type { VenueSettings } from '../catalog/api'
import { removeBanner, saveBanner } from './api'
import { BannerSection } from './BannerSection'
import { downscaleImage } from './imageResize'
import { MAX_UPLOAD_BYTES } from './mediaInput'

vi.mock('./api', () => ({ saveBanner: vi.fn(), removeBanner: vi.fn() }))
vi.mock('./imageResize', () => ({ downscaleImage: vi.fn() }))
vi.mock('../catalog/media', () => ({ mediaUrl: (path: string) => `https://cdn.test/${path}` }))

const OLD = 'banner/11111111-1111-1111-1111-111111111111.webp'
const NEW = 'banner/22222222-2222-2222-2222-222222222222.webp'
const settings = (banner_path: string | null = null, banner_alt: string | null = null) =>
  ({ venue_id: 'v1', name: 'Claudex Courts', banner_path, banner_alt }) as VenueSettings

const image = (type = 'image/jpeg') => new File([new Uint8Array(1)], 'banner', { type })
const resized = (size = 500) => {
  const b = new Blob(['x'], { type: 'image/webp' })
  Object.defineProperty(b, 'size', { value: size })
  return b
}

function renderSection(s: VenueSettings) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <BannerSection settings={s} />
    </QueryClientProvider>,
  )
}

const save = () => userEvent.click(screen.getByRole('button', { name: 'Save banner' }))

describe('BannerSection', () => {
  beforeEach(() => {
    vi.mocked(saveBanner).mockReset()
    vi.mocked(removeBanner).mockReset()
    vi.mocked(downscaleImage).mockReset().mockResolvedValue(resized())
  })

  it('shows an empty form without any alt text field when no banner is set', () => {
    renderSection(settings())
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Banner image')).toBeInTheDocument()
    expect(screen.queryByLabelText(/alt text/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/alt text/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove banner' })).not.toBeInTheDocument()
  })

  it('sets a banner: downscales to 2200 px and saves the image with alt "<venue name> banner"', async () => {
    const result = resized()
    vi.mocked(downscaleImage).mockResolvedValue(result)
    vi.mocked(saveBanner).mockResolvedValue(settings(NEW, 'Claudex Courts banner'))
    renderSection(settings())
    const file = image()
    await userEvent.upload(screen.getByLabelText('Banner image'), file)
    await save()
    expect(downscaleImage).toHaveBeenCalledWith(file, 2200)
    expect(saveBanner).toHaveBeenCalledWith(expect.objectContaining({ banner_path: null }), { alt: 'Claudex Courts banner', image: result })
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
  })

  it('truncates a long venue name so the generated alt is at most 200 characters', async () => {
    vi.mocked(saveBanner).mockResolvedValue(settings(NEW, 'x'))
    const s = { ...settings(), name: ` ${'N'.repeat(300)} ` } as VenueSettings
    renderSection(s)
    await userEvent.upload(screen.getByLabelText('Banner image'), image())
    await save()
    const alt = vi.mocked(saveBanner).mock.calls[0][1].alt
    expect(alt.length).toBeLessThanOrEqual(200)
    expect(alt).toBe(alt.trim())
    expect(alt.endsWith(' banner')).toBe(true)
    expect(alt.startsWith('NNNN')).toBe(true)
  })

  it('requires an image when no banner is set, and sends nothing', async () => {
    renderSection(settings())
    await save()
    expect(screen.getByLabelText('Banner image')).toHaveAccessibleDescription(/Choose an image for the banner/)
    expect(downscaleImage).not.toHaveBeenCalled()
    expect(saveBanner).not.toHaveBeenCalled()
  })

  it('requires an image when a banner exists too (no alt-only update any more)', async () => {
    renderSection(settings(OLD, 'Courts at dusk'))
    await save()
    expect(screen.getByLabelText('Replace image')).toHaveAccessibleDescription(/Choose an image for the banner/)
    expect(downscaleImage).not.toHaveBeenCalled()
    expect(saveBanner).not.toHaveBeenCalled()
  })

  it('refuses a wrong file type as soon as it is chosen', async () => {
    renderSection(settings())
    await userEvent.upload(screen.getByLabelText('Banner image'), image('image/svg+xml'), { applyAccept: false })
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a JPG, PNG or WEBP image.')
    await save()
    expect(downscaleImage).not.toHaveBeenCalled()
    expect(saveBanner).not.toHaveBeenCalled()
  })

  it('refuses an image still over 2 MB after resizing', async () => {
    vi.mocked(downscaleImage).mockResolvedValue(resized(MAX_UPLOAD_BYTES + 1))
    renderSection(settings())
    await userEvent.upload(screen.getByLabelText('Banner image'), image())
    await save()
    expect(screen.getByRole('alert')).toHaveTextContent('larger than 2 MB')
    expect(saveBanner).not.toHaveBeenCalled()
  })

  it('shows the current banner in both crops and replaces the image, keeping the stored alt', async () => {
    vi.mocked(saveBanner).mockResolvedValue(settings(NEW, 'Courts at dusk'))
    renderSection(settings(OLD, 'Courts at dusk'))
    // The phone crop repeats the image with empty alt, so only one image is announced.
    expect(screen.getByRole('img', { name: 'Courts at dusk' })).toHaveAttribute('src', `https://cdn.test/${OLD}`)
    expect(screen.getAllByRole('presentation')).toHaveLength(1)
    expect(screen.queryByLabelText(/alt text/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Replace image (optional)')).not.toBeInTheDocument()
    await userEvent.upload(screen.getByLabelText('Replace image'), image('image/png'))
    await save()
    expect(saveBanner).toHaveBeenCalledWith(expect.objectContaining({ banner_path: OLD }), { alt: 'Courts at dusk', image: expect.any(Blob) })
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
  })

  it('removes the banner', async () => {
    vi.mocked(removeBanner).mockResolvedValue(settings())
    renderSection(settings(OLD, 'Courts at dusk'))
    await userEvent.click(screen.getByRole('button', { name: 'Remove banner' }))
    expect(removeBanner).toHaveBeenCalledWith(expect.objectContaining({ banner_path: OLD }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
  })

  it('shows the error when the file is not a readable image', async () => {
    vi.mocked(downscaleImage).mockRejectedValue(new Error("That file isn't a readable image."))
    renderSection(settings())
    await userEvent.upload(screen.getByLabelText('Banner image'), image())
    await save()
    expect(screen.getByRole('alert')).toHaveTextContent("That file isn't a readable image.")
    expect(saveBanner).not.toHaveBeenCalled()
  })

  it('shows save and remove errors from the server', async () => {
    vi.mocked(saveBanner).mockRejectedValue(new ApiError("You don't have permission to change venue media."))
    // As unwrap() throws it: the raw PostgREST text plus its SQLSTATE, which the UI translates.
    vi.mocked(removeBanner).mockRejectedValue(new ApiError('permission denied for table venue_settings', '42501'))
    renderSection(settings(OLD, 'Courts at dusk'))
    await userEvent.upload(screen.getByLabelText('Replace image'), image())
    await save()
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission")
    await userEvent.click(screen.getByRole('button', { name: 'Remove banner' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("You don't have permission to do that. Try logging in again.")
    expect(alert).not.toHaveTextContent('venue_settings')
  })

  it('disables the form while saving', async () => {
    vi.mocked(saveBanner).mockReturnValue(new Promise(() => {}))
    renderSection(settings(OLD, 'Courts at dusk'))
    await userEvent.upload(screen.getByLabelText('Replace image'), image())
    await save()
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByLabelText('Replace image')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove banner' })).toBeDisabled()
  })
})
