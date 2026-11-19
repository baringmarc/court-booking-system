import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import type { VenueSettings } from '../catalog/api'
import { removeLogo, saveLogo } from './api'
import { cropSquareImage } from './imageResize'
import { LogoSection } from './LogoSection'
import { MAX_UPLOAD_BYTES } from './mediaInput'

vi.mock('./api', () => ({ saveLogo: vi.fn(), removeLogo: vi.fn() }))
vi.mock('./imageResize', () => ({ cropSquareImage: vi.fn() }))
vi.mock('../catalog/media', () => ({ mediaUrl: (path: string) => `https://cdn.test/${path}` }))

const OLD = 'v1/logo/11111111-1111-1111-1111-111111111111.webp'
const NEW = 'v1/logo/22222222-2222-2222-2222-222222222222.webp'
const settings = (logo_path: string | null = null) =>
  ({ venue_id: 'v1', name: 'Claudex Courts', logo_path }) as VenueSettings

const image = (type = 'image/png') => new File([new Uint8Array(1)], 'logo', { type })
const cropped = (size = 500) => {
  const b = new Blob(['x'], { type: 'image/webp' })
  Object.defineProperty(b, 'size', { value: size })
  return b
}

function renderSection(s: VenueSettings) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <LogoSection settings={s} />
    </QueryClientProvider>,
  )
}

const save = () => userEvent.click(screen.getByRole('button', { name: 'Save logo' }))

describe('LogoSection', () => {
  beforeEach(() => {
    vi.mocked(saveLogo).mockReset()
    vi.mocked(removeLogo).mockReset()
    vi.mocked(cropSquareImage).mockReset().mockResolvedValue(cropped())
  })

  it('shows the heading, the live stacks note and an empty form when no logo is set', () => {
    renderSection(settings())
    expect(screen.getByRole('heading', { level: 2, name: 'Venue logo' })).toBeInTheDocument()
    expect(screen.getByText(/live stacks/)).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Logo' })).toBeInTheDocument()
    expect(screen.getByLabelText('Logo image')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove logo' })).not.toBeInTheDocument()
  })

  it('sets a logo: crops to 512 px and saves the cropped image', async () => {
    const result = cropped()
    vi.mocked(cropSquareImage).mockResolvedValue(result)
    vi.mocked(saveLogo).mockResolvedValue(settings(NEW))
    renderSection(settings())
    const file = image()
    await userEvent.upload(screen.getByLabelText('Logo image'), file)
    await save()
    expect(cropSquareImage).toHaveBeenCalledWith(file, 512)
    expect(saveLogo).toHaveBeenCalledWith(expect.objectContaining({ logo_path: null }), { image: result })
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
  })

  it('requires an image, and sends nothing', async () => {
    renderSection(settings())
    await save()
    expect(screen.getByRole('alert')).toHaveTextContent('Choose an image for the logo.')
    expect(screen.getByLabelText('Logo image')).toHaveAccessibleDescription(/Choose an image for the logo\./)
    expect(cropSquareImage).not.toHaveBeenCalled()
    expect(saveLogo).not.toHaveBeenCalled()
  })

  it('requires an image when a logo exists too', async () => {
    renderSection(settings(OLD))
    await save()
    expect(screen.getByLabelText('Replace image')).toHaveAccessibleDescription(/Choose an image for the logo\./)
    expect(saveLogo).not.toHaveBeenCalled()
  })

  it('refuses a wrong file type as soon as it is chosen', async () => {
    renderSection(settings())
    await userEvent.upload(screen.getByLabelText('Logo image'), image('image/svg+xml'), { applyAccept: false })
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a JPG, PNG or WEBP image.')
    await save()
    expect(cropSquareImage).not.toHaveBeenCalled()
    expect(saveLogo).not.toHaveBeenCalled()
  })

  it('refuses a file over 15 MB as soon as it is chosen', async () => {
    renderSection(settings())
    const big = image()
    Object.defineProperty(big, 'size', { value: 15 * 1024 * 1024 + 1 })
    await userEvent.upload(screen.getByLabelText('Logo image'), big)
    expect(screen.getByRole('alert')).toHaveTextContent('The image is larger than 15 MB.')
    await save()
    expect(saveLogo).not.toHaveBeenCalled()
  })

  it('refuses an image still over 2 MB after cropping', async () => {
    vi.mocked(cropSquareImage).mockResolvedValue(cropped(MAX_UPLOAD_BYTES + 1))
    renderSection(settings())
    await userEvent.upload(screen.getByLabelText('Logo image'), image())
    await save()
    expect(screen.getByRole('alert')).toHaveTextContent('Even after resizing, the image is larger than 2 MB. Try a smaller image.')
    expect(saveLogo).not.toHaveBeenCalled()
  })

  it('shows the error when the file is not a readable image', async () => {
    vi.mocked(cropSquareImage).mockRejectedValue(new Error("That file isn't a readable image."))
    renderSection(settings())
    await userEvent.upload(screen.getByLabelText('Logo image'), image())
    await save()
    expect(screen.getByRole('alert')).toHaveTextContent("That file isn't a readable image.")
    expect(saveLogo).not.toHaveBeenCalled()
  })

  it('shows the current logo with alt "<venue name> logo" and replaces it', async () => {
    vi.mocked(saveLogo).mockResolvedValue(settings(NEW))
    renderSection(settings(OLD))
    expect(screen.getByRole('img', { name: 'Claudex Courts logo' })).toHaveAttribute('src', `https://cdn.test/${OLD}`)
    expect(screen.queryByLabelText('Logo image')).not.toBeInTheDocument()
    await userEvent.upload(screen.getByLabelText('Replace image'), image())
    await save()
    expect(saveLogo).toHaveBeenCalledWith(expect.objectContaining({ logo_path: OLD }), { image: expect.any(Blob) })
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
  })

  it('shows the server error when saving fails', async () => {
    vi.mocked(saveLogo).mockRejectedValue(new ApiError("You don't have permission to change venue media."))
    renderSection(settings(OLD))
    await userEvent.upload(screen.getByLabelText('Replace image'), image())
    await save()
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission")
  })

  it('disables the form while saving', async () => {
    vi.mocked(saveLogo).mockReturnValue(new Promise(() => {}))
    renderSection(settings(OLD))
    await userEvent.upload(screen.getByLabelText('Replace image'), image())
    await save()
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByLabelText('Replace image')).toBeDisabled()
  })

  it('asks before removing: Keep logo closes the dialog and calls nothing', async () => {
    renderSection(settings(OLD))
    await userEvent.click(screen.getByRole('button', { name: 'Remove logo' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove the logo?' })
    expect(screen.getByRole('button', { name: 'Keep logo' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Keep logo' }))
    expect(dialog).not.toBeInTheDocument()
    expect(removeLogo).not.toHaveBeenCalled()
  })

  it('removes the logo after confirming', async () => {
    vi.mocked(removeLogo).mockResolvedValue(settings())
    renderSection(settings(OLD))
    await userEvent.click(screen.getByRole('button', { name: 'Remove logo' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove it' }))
    expect(removeLogo).toHaveBeenCalledWith(expect.objectContaining({ logo_path: OLD }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
  })

  it('shows "Removing…" on the trigger while pending', async () => {
    vi.mocked(removeLogo).mockReturnValue(new Promise(() => {}))
    renderSection(settings(OLD))
    await userEvent.click(screen.getByRole('button', { name: 'Remove logo' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove it' }))
    expect(await screen.findByRole('button', { name: 'Removing…' })).toBeDisabled()
  })

  it('shows a remove error as an alert', async () => {
    vi.mocked(removeLogo).mockRejectedValue(new ApiError('permission denied for table venue_settings', '42501'))
    renderSection(settings(OLD))
    await userEvent.click(screen.getByRole('button', { name: 'Remove logo' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove it' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("You don't have permission to do that. Try logging in again.")
    expect(alert).not.toHaveTextContent('venue_settings')
  })
})
