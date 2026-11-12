import { fireEvent, render, screen, within } from '@testing-library/react'
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
  afterEach(() => { vi.restoreAllMocks() })

  it('lists every photo in order with alt text that says which one it is', () => {
    render(<CourtGallery court={court} photos={photos} />)
    const group = screen.getByRole('group', { name: 'Photos of Badminton 1' })
    expect(group).toBeInTheDocument()
    expect(screen.getAllByRole('img').map((img) => img.getAttribute('alt'))).toEqual([
      'Photo 1 of 3 of Badminton 1', 'Photo 2 of 3 of Badminton 1', 'Photo 3 of 3 of Badminton 1',
    ])
  })

  it('moves with the buttons, shows where it is, and hides an arrow at its end (no wrap-around)', async () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(() => {})
    render(<CourtGallery court={court} photos={photos} />)
    const prevName = 'Previous photo of Badminton 1'
    const nextName = 'Next photo of Badminton 1'
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.getByText('1 / 3')).toHaveAttribute('aria-live', 'polite')
    expect(screen.queryByRole('button', { name: prevName })).toBeNull()
    expect(screen.getByRole('button', { name: nextName })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: nextName }))
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(scrollTo).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: prevName })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: nextName }))
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: nextName })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: prevName }))
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nextName })).toBeInTheDocument()
  })

  it('moves focus to the opposite arrow when the focused arrow disappears at an end', async () => {
    render(<CourtGallery court={court} photos={photos} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next photo of Badminton 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next photo of Badminton 1' }))
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous photo of Badminton 1' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Previous photo of Badminton 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Previous photo of Badminton 1' }))
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next photo of Badminton 1' })).toHaveFocus()
  })

  it('keeps the arrows outside the full-screen photo buttons and uses chevron icons', () => {
    render(<CourtGallery court={court} photos={photos} />)
    for (const open of screen.getAllByRole('button', { name: /^View full screen/ })) {
      expect(within(open).queryByRole('button')).toBeNull()
    }
    const next = screen.getByRole('button', { name: 'Next photo of Badminton 1' })
    expect(next.closest('button[aria-label^="View full screen"]')).toBeNull()
    expect(next.querySelector('svg')).not.toBeNull()
    expect(next).not.toHaveTextContent(/[‹›]/)
  })

  it('follows a swipe: the counter updates from the scroll position', () => {
    render(<CourtGallery court={court} photos={photos} />)
    const strip = screen.getAllByRole('list')[0]
    Object.defineProperty(strip, 'clientWidth', { value: 300, configurable: true })
    Object.defineProperty(strip, 'scrollLeft', { value: 600, configurable: true })
    fireEvent.scroll(strip)
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })

  it('shows a single photo, or the sport placeholder, without gallery controls', () => {
    const { rerender } = render(<CourtGallery court={court} photos={photos.slice(0, 1)} />)
    expect(screen.getByRole('img', { name: 'Photo of Badminton 1' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Next photo|Previous photo/ })).not.toBeInTheDocument()
    expect(screen.queryByText('1 of 1')).not.toBeInTheDocument()
    expect(screen.queryByText('1 / 1')).not.toBeInTheDocument()
    rerender(<CourtGallery court={court} photos={[]} />)
    expect(screen.getByRole('img', { name: 'Badminton court' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument() // the placeholder never opens
  })

  it('opens a tapped photo full screen, moves between photos, and returns focus on Escape', async () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(() => {})
    render(<CourtGallery court={court} photos={photos} />)
    const second = screen.getByRole('button', { name: 'View full screen: Photo 2 of 3 of Badminton 1' })
    await userEvent.click(second)
    const viewer = screen.getByRole('dialog', { name: 'Photos of Badminton 1' })
    expect(within(viewer).getByRole('img')).toHaveAttribute('alt', 'Photo 2 of 3 of Badminton 1')
    expect(within(viewer).getByText('2 of 3')).toBeInTheDocument()

    await userEvent.click(within(viewer).getByRole('button', { name: 'Next photo' }))
    expect(within(viewer).getByRole('img')).toHaveAttribute('src', `https://cdn.test/${photos[2].path}`)
    expect(within(viewer).getByRole('button', { name: 'Next photo' })).toBeDisabled()
    await userEvent.click(within(viewer).getByRole('button', { name: 'Previous photo' }))
    expect(within(viewer).getByText('2 of 3')).toBeInTheDocument()

    await userEvent.keyboard('{ArrowRight}')
    expect(within(viewer).getByText('3 of 3')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(second).toHaveFocus()
    // The strip follows the viewer to the photo it closed on.
    expect(screen.getAllByText('3 / 3')).toHaveLength(1)
    expect(scrollTo).toHaveBeenCalled()
  })

  it('shows the cover alone as a plain image, with no full-screen button or dialog (the home page tiles)', async () => {
    render(<CourtGallery court={court} photos={photos} coverOnly />)
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Photo of Badminton 1')
    expect(screen.queryByRole('button')).toBeNull()
    await userEvent.click(screen.getByRole('img'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stays within the list when it shrinks under an open gallery', async () => {
    const { rerender } = render(<CourtGallery court={court} photos={photos} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next photo of Badminton 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next photo of Badminton 1' }))
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
    rerender(<CourtGallery court={court} photos={photos.slice(0, 2)} />)
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next photo of Badminton 1' })).toBeNull()
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
