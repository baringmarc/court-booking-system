import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PhotoViewer } from './PhotoViewer'

const photos = [1, 2, 3].map((n) => ({ src: `https://cdn.test/${n}.webp`, alt: `Photo ${n}` }))

function renderViewer(start = 0, onClose = vi.fn()) {
  render(<PhotoViewer photos={photos} start={start} label="Photos of Court 1" onClose={onClose} />)
  return onClose
}

const swipe = (el: Element, from: number, to: number) => {
  fireEvent.touchStart(el, { touches: [{ clientX: from }] })
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: to }] })
}

describe('PhotoViewer', () => {
  it('opens on the chosen photo as a named modal dialog', () => {
    renderViewer(1)
    const dialog = screen.getByRole('dialog', { name: 'Photos of Court 1' })
    expect(dialog).toHaveAttribute('open')
    expect(screen.getByRole('img', { name: 'Photo 2' })).toHaveAttribute('src', 'https://cdn.test/2.webp')
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
  })

  it('moves with a one-finger swipe, and ignores short drags and pinches', () => {
    renderViewer(0)
    const stage = screen.getByRole('img').parentElement!
    swipe(stage, 300, 100) // left: next
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    swipe(stage, 100, 300) // right: previous
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    swipe(stage, 300, 280) // too short
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    fireEvent.touchStart(stage, { touches: [{ clientX: 300 }, { clientX: 100 }] })
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 50 }] })
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
  })

  it('stops at the ends with the arrow keys', async () => {
    renderViewer(0)
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
  })

  it('stays within the list when it shrinks while open', () => {
    const { rerender } = render(<PhotoViewer photos={photos} start={2} label="Photos of Court 1" onClose={vi.fn()} />)
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
    rerender(<PhotoViewer photos={photos.slice(0, 2)} start={2} label="Photos of Court 1" onClose={vi.fn()} />)
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Photo 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next photo' })).toBeDisabled()
  })

  it('keeps focus inside when the photo is clicked, so the arrow keys still work', async () => {
    renderViewer(0)
    expect(screen.getByRole('dialog')).toHaveAttribute('tabindex', '-1')
  })

  it('closes from its button with the photo on screen', async () => {
    const onClose = renderViewer(2)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledWith(2)
  })

  it('has no counter or arrows for a single photo, and says when a photo fails to load', () => {
    render(<PhotoViewer photos={photos.slice(0, 1)} start={0} label="Banner photo" onClose={vi.fn()} />)
    expect(screen.queryByText('1 of 1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next photo' })).not.toBeInTheDocument()
    fireEvent.error(screen.getByRole('img', { name: 'Photo 1' }))
    expect(screen.getByText("This photo couldn't be loaded.")).toBeInTheDocument()
  })
})
