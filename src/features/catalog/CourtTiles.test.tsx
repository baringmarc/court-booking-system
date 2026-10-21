import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CourtPhotoRow, CourtWithPhotos } from './api'
import { CourtTiles } from './CourtTiles'

vi.mock('./media', () => ({ mediaUrl: (path: string) => `https://cdn.test/${path}` }))

const PHOTO = 'courts/c1/11111111-1111-1111-1111-111111111111.webp'
const SECOND = 'courts/c1/22222222-2222-2222-2222-222222222222.webp'
const photo = (path: string, sort_order = 0): CourtPhotoRow => ({ id: path, path, sort_order })
const court = (id: string, name: string, overrides: Partial<CourtWithPhotos> = {}) =>
  ({ id, name, sport: 'badminton', description: 'Wooden floor.', court_photos: [], ...overrides }) as CourtWithPhotos

describe('CourtTiles', () => {
  it("shows a court's cover photo, lazy-loaded with fixed dimensions", () => {
    render(<CourtTiles courts={[court('c1', 'Badminton 1', { court_photos: [photo(PHOTO), photo(SECOND, 1)] })]} />)
    const img = screen.getByRole('img', { name: 'Photo of Badminton 1' })
    expect(img).toHaveAttribute('src', `https://cdn.test/${PHOTO}`)
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('width', '640')
    expect(img).toHaveAttribute('height', '360')
    // Cards show the cover only; the gallery is for the court info panel.
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('shows a sport placeholder, not an <img>, for a court without photos', () => {
    const { container } = render(<CourtTiles courts={[court('c2', 'Tennis 1', { sport: 'tennis' })]} />)
    expect(screen.getByRole('img', { name: 'Tennis court' })).toHaveTextContent('🎾')
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('Tennis 1')).toBeInTheDocument()
  })

  it('shows courts with and without photos side by side', () => {
    render(<CourtTiles courts={[court('c1', 'Badminton 1', { court_photos: [photo(PHOTO)] }), court('c2', 'Badminton 2')]} />)
    const [withPhoto, without] = screen.getAllByRole('listitem')
    expect(within(withPhoto).getByRole('img', { name: 'Photo of Badminton 1' })).toBeInTheDocument()
    expect(within(without).getByRole('img', { name: 'Badminton court' })).toBeInTheDocument()
  })

  it('falls back to the placeholder when the photo fails to load (never a broken image)', () => {
    render(<CourtTiles courts={[court('c1', 'Badminton 1', { court_photos: [photo(PHOTO)] })]} />)
    fireEvent.error(screen.getByRole('img', { name: 'Photo of Badminton 1' }))
    expect(screen.queryByRole('img', { name: 'Photo of Badminton 1' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Badminton court' })).toBeInTheDocument()
  })

  it('tries again when the court gets a new cover after a failed one', () => {
    const { rerender } = render(<CourtTiles courts={[court('c1', 'Badminton 1', { court_photos: [photo(PHOTO)] })]} />)
    fireEvent.error(screen.getByRole('img', { name: 'Photo of Badminton 1' }))
    rerender(<CourtTiles courts={[court('c1', 'Badminton 1', { court_photos: [photo(SECOND)] })]} />)
    expect(screen.getByRole('img', { name: 'Photo of Badminton 1' })).toHaveAttribute('src', `https://cdn.test/${SECOND}`)
  })

  it('shows descriptions and every photo in the detailed view', () => {
    const courts = [court('c1', 'Badminton 1', { court_photos: [photo(PHOTO), photo(SECOND, 1)] })]
    const { rerender } = render(<CourtTiles courts={courts} />)
    expect(screen.queryByText('Wooden floor.')).not.toBeInTheDocument()
    rerender(<CourtTiles courts={courts} detailed />)
    expect(screen.getByText('Wooden floor.')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Photos of Badminton 1' })).getAllByRole('img')).toHaveLength(2)
  })
})
