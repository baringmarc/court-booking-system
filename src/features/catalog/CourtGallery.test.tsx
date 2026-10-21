import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CourtPhotoRow } from './api'
import { CourtGallery } from './CourtGallery'

vi.mock('./media', () => ({ mediaUrl: (path: string) => `https://cdn.test/${path}` }))

const court = { name: 'Badminton 1', sport: 'badminton' as const }
const photos: CourtPhotoRow[] = [1, 2, 3].map((n) => ({
  id: `p${n}`, path: `courts/c1/0000000${n}-0000-0000-0000-000000000000.webp`, sort_order: n - 1,
}))

// jsdom has no scrollTo on elements; give it a no-op the tests can spy on.
Element.prototype.scrollTo ??= () => {}

describe('CourtGallery', () => {
  afterEach(() => vi.restoreAllMocks())

  it('lists every photo in order with alt text that says which one it is', () => {
    render(<CourtGallery court={court} photos={photos} />)
    const group = screen.getByRole('group', { name: 'Photos of Badminton 1' })
    expect(group).toBeInTheDocument()
    expect(screen.getAllByRole('img').map((img) => img.getAttribute('alt'))).toEqual([
      'Photo 1 of 3 of Badminton 1', 'Photo 2 of 3 of Badminton 1', 'Photo 3 of 3 of Badminton 1',
    ])
  })

  it('moves with the buttons, shows where it is, and disables them at the ends', async () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(() => {})
    render(<CourtGallery court={court} photos={photos} />)
    const prev = screen.getByRole('button', { name: 'Previous photo of Badminton 1' })
    const next = screen.getByRole('button', { name: 'Next photo of Badminton 1' })
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    expect(prev).toBeDisabled()

    await userEvent.click(next)
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    expect(scrollTo).toHaveBeenCalled()
    await userEvent.click(next)
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
    expect(next).toBeDisabled()
    await userEvent.click(prev)
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
  })

  it('follows a swipe: the counter updates from the scroll position', () => {
    render(<CourtGallery court={court} photos={photos} />)
    const strip = screen.getAllByRole('list')[0]
    Object.defineProperty(strip, 'clientWidth', { value: 300, configurable: true })
    Object.defineProperty(strip, 'scrollLeft', { value: 600, configurable: true })
    fireEvent.scroll(strip)
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
  })

  it('shows a single photo, or the sport placeholder, without gallery controls', () => {
    const { rerender } = render(<CourtGallery court={court} photos={photos.slice(0, 1)} />)
    expect(screen.getByRole('img', { name: 'Photo of Badminton 1' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(<CourtGallery court={court} photos={[]} />)
    expect(screen.getByRole('img', { name: 'Badminton court' })).toBeInTheDocument()
  })

  it('stays within the list when it shrinks under an open gallery', async () => {
    const { rerender } = render(<CourtGallery court={court} photos={photos} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next photo of Badminton 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next photo of Badminton 1' }))
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
    rerender(<CourtGallery court={court} photos={photos.slice(0, 2)} />)
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next photo of Badminton 1' })).toBeDisabled()
  })

  it('lets keyboard users focus the scrollable strip', () => {
    render(<CourtGallery court={court} photos={photos} />)
    expect(screen.getByRole('list', { name: 'Badminton 1 photos, swipe or scroll' })).toHaveAttribute('tabindex', '0')
  })

  it('replaces a photo that fails to load with the placeholder', () => {
    render(<CourtGallery court={court} photos={photos} />)
    fireEvent.error(screen.getByRole('img', { name: 'Photo 2 of 3 of Badminton 1' }))
    expect(screen.getByRole('img', { name: 'Badminton court' })).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(3)
  })
})
