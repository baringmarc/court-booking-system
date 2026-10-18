import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Court } from './api'
import { CourtTiles } from './CourtTiles'

vi.mock('./media', () => ({ mediaUrl: (path: string) => `https://cdn.test/${path}` }))

const PHOTO = 'courts/c1/11111111-1111-1111-1111-111111111111.webp'
const court = (id: string, name: string, overrides: Partial<Court> = {}) =>
  ({ id, name, sport: 'badminton', description: 'Wooden floor.', photo_path: null, ...overrides }) as Court

describe('CourtTiles', () => {
  it("shows a court's photo, lazy-loaded with fixed dimensions", () => {
    render(<CourtTiles courts={[court('c1', 'Badminton 1', { photo_path: PHOTO })]} />)
    const img = screen.getByRole('img', { name: 'Photo of Badminton 1' })
    expect(img).toHaveAttribute('src', `https://cdn.test/${PHOTO}`)
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('width', '640')
    expect(img).toHaveAttribute('height', '360')
  })

  it('shows a sport placeholder, not an <img>, for a court without a photo', () => {
    const { container } = render(<CourtTiles courts={[court('c2', 'Tennis 1', { sport: 'tennis' })]} />)
    expect(screen.getByRole('img', { name: 'Tennis court' })).toHaveTextContent('🎾')
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('Tennis 1')).toBeInTheDocument()
  })

  it('shows courts with and without photos side by side', () => {
    render(<CourtTiles courts={[court('c1', 'Badminton 1', { photo_path: PHOTO }), court('c2', 'Badminton 2')]} />)
    const [withPhoto, without] = screen.getAllByRole('listitem')
    expect(within(withPhoto).getByRole('img', { name: 'Photo of Badminton 1' })).toBeInTheDocument()
    expect(within(without).getByRole('img', { name: 'Badminton court' })).toBeInTheDocument()
  })

  it('falls back to the placeholder when the photo fails to load (never a broken image)', () => {
    render(<CourtTiles courts={[court('c1', 'Badminton 1', { photo_path: PHOTO })]} />)
    fireEvent.error(screen.getByRole('img', { name: 'Photo of Badminton 1' }))
    expect(screen.queryByRole('img', { name: 'Photo of Badminton 1' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Badminton court' })).toBeInTheDocument()
  })

  it('tries again when the court gets a new photo after a failed one', () => {
    const { rerender } = render(<CourtTiles courts={[court('c1', 'Badminton 1', { photo_path: PHOTO })]} />)
    fireEvent.error(screen.getByRole('img', { name: 'Photo of Badminton 1' }))
    const next = 'courts/c1/22222222-2222-2222-2222-222222222222.webp'
    rerender(<CourtTiles courts={[court('c1', 'Badminton 1', { photo_path: next })]} />)
    expect(screen.getByRole('img', { name: 'Photo of Badminton 1' })).toHaveAttribute('src', `https://cdn.test/${next}`)
  })

  it('shows descriptions only when asked', () => {
    const { rerender } = render(<CourtTiles courts={[court('c1', 'Badminton 1')]} />)
    expect(screen.queryByText('Wooden floor.')).not.toBeInTheDocument()
    rerender(<CourtTiles courts={[court('c1', 'Badminton 1')]} showDescription />)
    expect(screen.getByText('Wooden floor.')).toBeInTheDocument()
  })
})
