import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import type { Court } from '../catalog/api'
import { removeCourtPhoto, setCourtPhoto } from './api'
import { CourtPhotoSection } from './CourtPhotoSection'
import { downscaleImage } from './imageResize'
import { MAX_SOURCE_BYTES, MAX_UPLOAD_BYTES } from './mediaInput'

vi.mock('./api', () => ({ setCourtPhoto: vi.fn(), removeCourtPhoto: vi.fn() }))
vi.mock('./imageResize', () => ({ downscaleImage: vi.fn() }))
vi.mock('../catalog/media', () => ({ mediaUrl: (path: string) => `https://cdn.test/${path}` }))

const court = (photo_path: string | null = null) => ({
  id: 'c1', name: 'Badminton 1', sport: 'badminton', photo_path,
} as Court)
const OLD = 'courts/c1/11111111-1111-1111-1111-111111111111.webp'
const NEW = 'courts/c1/22222222-2222-2222-2222-222222222222.webp'

const image = (type = 'image/jpeg', size = 1000) => {
  const f = new File([new Uint8Array(1)], 'photo', { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}
const resized = (size = 500) => {
  const b = new Blob(['x'], { type: 'image/webp' })
  Object.defineProperty(b, 'size', { value: size })
  return b
}

function renderSection(c: Court) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CourtPhotoSection court={c} />
    </QueryClientProvider>,
  )
}

describe('CourtPhotoSection', () => {
  beforeEach(() => {
    vi.mocked(setCourtPhoto).mockReset()
    vi.mocked(removeCourtPhoto).mockReset()
    vi.mocked(downscaleImage).mockReset().mockResolvedValue(resized())
  })

  it('shows a hint and an upload field when the court has no photo', () => {
    renderSection(court())
    expect(screen.getByText(/No photo yet/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Upload a photo')).toHaveAccessibleDescription(/JPG, PNG or WEBP, up to 15 MB/)
    expect(screen.queryByRole('button', { name: 'Remove photo' })).not.toBeInTheDocument()
  })

  it('downscales the chosen image to 1600 px and uploads the result', async () => {
    const result = resized()
    vi.mocked(downscaleImage).mockResolvedValue(result)
    vi.mocked(setCourtPhoto).mockResolvedValue({ ...court(), photo_path: NEW } as Court)
    renderSection(court())
    const file = image()
    await userEvent.upload(screen.getByLabelText('Upload a photo'), file)
    expect(downscaleImage).toHaveBeenCalledWith(file, 1600)
    expect(setCourtPhoto).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', photo_path: null }), result)
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
  })

  it('refuses a wrong type before sending anything', async () => {
    renderSection(court())
    // applyAccept: false lets the test pick a file the accept attribute would hide.
    await userEvent.upload(screen.getByLabelText('Upload a photo'), image('image/gif'), { applyAccept: false })
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a JPG, PNG or WEBP image.')
    expect(screen.getByLabelText('Upload a photo')).toHaveAttribute('aria-invalid', 'true')
    expect(downscaleImage).not.toHaveBeenCalled()
    expect(setCourtPhoto).not.toHaveBeenCalled()
  })

  it('refuses a source file over 15 MB before sending anything', async () => {
    renderSection(court())
    await userEvent.upload(screen.getByLabelText('Upload a photo'), image('image/jpeg', MAX_SOURCE_BYTES + 1))
    expect(screen.getByRole('alert')).toHaveTextContent('larger than 15 MB')
    expect(downscaleImage).not.toHaveBeenCalled()
  })

  it('refuses an image that is still over 2 MB after resizing', async () => {
    vi.mocked(downscaleImage).mockResolvedValue(resized(MAX_UPLOAD_BYTES + 1))
    renderSection(court())
    await userEvent.upload(screen.getByLabelText('Upload a photo'), image())
    expect(screen.getByRole('alert')).toHaveTextContent('larger than 2 MB')
    expect(setCourtPhoto).not.toHaveBeenCalled()
  })

  it('shows the error when the file is not a readable image', async () => {
    vi.mocked(downscaleImage).mockRejectedValue(new Error("That file isn't a readable image."))
    renderSection(court())
    await userEvent.upload(screen.getByLabelText('Upload a photo'), image())
    expect(screen.getByRole('alert')).toHaveTextContent("That file isn't a readable image.")
    expect(setCourtPhoto).not.toHaveBeenCalled()
  })

  it('shows the current photo and replaces it', async () => {
    vi.mocked(setCourtPhoto).mockResolvedValue({ ...court(OLD), photo_path: NEW } as Court)
    renderSection(court(OLD))
    expect(screen.getByRole('img', { name: 'Photo of Badminton 1' })).toHaveAttribute('src', `https://cdn.test/${OLD}`)
    await userEvent.upload(screen.getByLabelText('Replace photo'), image('image/png'))
    expect(setCourtPhoto).toHaveBeenCalledWith(expect.objectContaining({ photo_path: OLD }), expect.any(Blob))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
  })

  it('removes the photo', async () => {
    vi.mocked(removeCourtPhoto).mockResolvedValue(court())
    renderSection(court(OLD))
    await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
    expect(removeCourtPhoto).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', photo_path: OLD }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
  })

  it('shows upload errors from the server', async () => {
    vi.mocked(setCourtPhoto).mockRejectedValue(new ApiError('new row violates row-level security policy'))
    renderSection(court())
    await userEvent.upload(screen.getByLabelText('Upload a photo'), image())
    expect(await screen.findByRole('alert')).toHaveTextContent('row-level security')
  })

  it('shows remove errors from the server', async () => {
    vi.mocked(removeCourtPhoto).mockRejectedValue(new ApiError('permission denied for table courts'))
    renderSection(court(OLD))
    await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
  })

  it('disables the controls while uploading', async () => {
    vi.mocked(setCourtPhoto).mockReturnValue(new Promise(() => {}))
    renderSection(court(OLD))
    await userEvent.upload(screen.getByLabelText('Replace photo'), image())
    expect(await screen.findByRole('status')).toHaveTextContent('Uploading…')
    expect(screen.getByLabelText('Replace photo')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeDisabled()
  })
})
