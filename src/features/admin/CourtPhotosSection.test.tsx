import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import type { CourtPhotoRow, CourtWithPhotos } from '../catalog/api'
import { addCourtPhoto, removeCourtPhoto, reorderCourtPhotos } from './api'
import { CourtPhotosSection } from './CourtPhotosSection'
import { downscaleImage } from './imageResize'

vi.mock('./api', () => ({ addCourtPhoto: vi.fn(), removeCourtPhoto: vi.fn(), reorderCourtPhotos: vi.fn() }))
vi.mock('./imageResize', () => ({ downscaleImage: vi.fn() }))
vi.mock('../catalog/media', () => ({ mediaUrl: (path: string) => `https://cdn.test/${path}` }))

const photo = (n: number, sort_order = n - 1): CourtPhotoRow => ({
  id: `p${n}`, path: `courts/c1/0000000${n}-0000-0000-0000-000000000000.webp`, sort_order,
})
const court = (photos: CourtPhotoRow[]) =>
  ({ id: 'c1', name: 'Badminton 1', sport: 'badminton', court_photos: photos }) as CourtWithPhotos
const file = (name: string, type = 'image/jpeg') => new File([new Uint8Array(1)], name, { type })
const resized = (size = 500) => {
  const b = new Blob(['x'], { type: 'image/webp' })
  Object.defineProperty(b, 'size', { value: size })
  return b
}

function renderSection(c: CourtWithPhotos) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><CourtPhotosSection court={c} /></QueryClientProvider>)
}

describe('CourtPhotosSection', () => {
  beforeEach(() => {
    vi.mocked(addCourtPhoto).mockReset().mockImplementation(async (_c, _i, sort_order) => ({ id: 'new', path: 'x', sort_order }))
    vi.mocked(removeCourtPhoto).mockReset().mockResolvedValue()
    vi.mocked(reorderCourtPhotos).mockReset().mockResolvedValue()
    vi.mocked(downscaleImage).mockReset().mockResolvedValue(resized())
  })

  it('starts empty, with room for 6 photos', () => {
    renderSection(court([]))
    expect(screen.getByText(/No photos yet/)).toBeInTheDocument()
    expect(screen.getByLabelText('Add photos')).toBeEnabled()
    expect(screen.getByText(/Up to 6 photos \(6 more fit\)/)).toBeInTheDocument()
  })

  it('marks the first photo as the cover', () => {
    renderSection(court([photo(1), photo(2)]))
    const [first, second] = screen.getAllByRole('listitem')
    expect(within(first).getByText('Cover')).toBeInTheDocument()
    expect(within(second).queryByText('Cover')).not.toBeInTheDocument()
    expect(within(first).queryByRole('button', { name: /Make cover/ })).not.toBeInTheDocument()
  })

  it('downscales and adds several photos after the last one, in the order they were picked', async () => {
    renderSection(court([photo(1)]))
    await userEvent.upload(screen.getByLabelText('Add photos'), [file('a.jpg'), file('b.jpg')])
    expect(downscaleImage).toHaveBeenCalledTimes(2)
    expect(downscaleImage).toHaveBeenCalledWith(expect.any(File), 1600)
    expect(vi.mocked(addCourtPhoto).mock.calls.map(([c, , order]) => [c, order])).toEqual([['c1', 1], ['c1', 2]])
  })

  it('uploads only as many photos as fit and says the rest were skipped', async () => {
    renderSection(court([1, 2, 3, 4, 5].map((n) => photo(n))))
    await userEvent.upload(screen.getByLabelText('Add photos'), [file('a.jpg'), file('b.jpg'), file('c.jpg')])
    expect(addCourtPhoto).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Only 1 more photo fits \(6 at most\)\. The rest were skipped\./)).toBeInTheDocument()
  })

  it('turns the upload off when the court has 6 photos', () => {
    renderSection(court([1, 2, 3, 4, 5, 6].map((n) => photo(n))))
    expect(screen.getByLabelText('Add photos')).toBeDisabled()
    expect(screen.getByText(/has 6 photos, the most allowed/)).toBeInTheDocument()
  })

  it('refuses a file of the wrong type and still uploads the good ones', async () => {
    renderSection(court([]))
    await userEvent.upload(screen.getByLabelText('Add photos'), [file('notes.gif', 'image/gif'), file('ok.jpg')], { applyAccept: false })
    expect(await screen.findByText('notes.gif: Choose a JPG, PNG or WEBP image.')).toBeInTheDocument()
    expect(addCourtPhoto).toHaveBeenCalledTimes(1)
  })

  it('refuses an image still over 2 MB after resizing', async () => {
    vi.mocked(downscaleImage).mockResolvedValue(resized(3 * 1024 * 1024))
    renderSection(court([]))
    await userEvent.upload(screen.getByLabelText('Add photos'), file('big.jpg'))
    expect(await screen.findByText(/big\.jpg: Even after resizing, the image is larger than 2 MB/)).toBeInTheDocument()
    expect(addCourtPhoto).not.toHaveBeenCalled()
  })

  it('shows an upload error from the server', async () => {
    vi.mocked(addCourtPhoto).mockRejectedValue(new ApiError('A court can have at most 6 photos. Remove one first.', 'P0001', 'too_many_photos'))
    renderSection(court([]))
    await userEvent.upload(screen.getByLabelText('Add photos'), file('a.jpg'))
    expect(await screen.findByText('A court can have at most 6 photos. Remove one first.')).toBeInTheDocument()
  })

  it('removes a photo', async () => {
    renderSection(court([photo(1), photo(2)]))
    await userEvent.click(screen.getByRole('button', { name: 'Remove photo 2' }))
    expect(removeCourtPhoto).toHaveBeenCalledWith(photo(2))
  })

  it('makes a photo the cover, keeping the others in order', async () => {
    renderSection(court([photo(1), photo(2), photo(3)]))
    await userEvent.click(screen.getByRole('button', { name: 'Make cover: photo 3' }))
    expect(reorderCourtPhotos).toHaveBeenCalledWith('c1', ['p3', 'p1', 'p2'])
  })

  it('keeps reordering and adding or removing from overlapping', async () => {
    let finishRemove = () => {}
    vi.mocked(removeCourtPhoto).mockImplementation(() => new Promise<void>((resolve) => { finishRemove = resolve }))
    renderSection(court([photo(1), photo(2), photo(3)]))
    await userEvent.click(screen.getByRole('button', { name: 'Remove photo 3' }))
    // While a removal runs, the order can't change (its photo list would be out of date).
    expect(screen.getByRole('button', { name: 'Move photo 1 down' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Make cover: photo 2' })).toBeDisabled()
    finishRemove()

    let finishReorder = () => {}
    vi.mocked(reorderCourtPhotos).mockImplementation(() => new Promise<void>((resolve) => { finishReorder = resolve }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Move photo 1 down' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Move photo 1 down' }))
    // While a reorder is saving, photos can't be added or removed.
    expect(screen.getByLabelText('Add photos')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove photo 1' })).toBeDisabled()
    finishReorder()
    await vi.waitFor(() => expect(screen.getByLabelText('Add photos')).toBeEnabled())
  })

  it('moves a photo with the arrows', async () => {
    renderSection(court([photo(1), photo(2), photo(3)]))
    expect(screen.getByRole('button', { name: 'Move photo 1 up' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Move photo 1 down' }))
    expect(reorderCourtPhotos).toHaveBeenCalledWith('c1', ['p2', 'p1', 'p3'])
  })
})
