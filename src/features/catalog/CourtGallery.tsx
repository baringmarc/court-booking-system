import { useRef, useState } from 'react'
import type { Court, CourtPhotoRow } from './api'
import { CourtPhoto } from './CourtPhoto'

type Props = { court: Pick<Court, 'name' | 'sport'>; photos: CourtPhotoRow[] }

/**
 * A court's photos as a swipeable strip (CSS scroll-snap, no library), with previous and next buttons and a
 * "2 of 4" counter for people who don't swipe (T9.7). One photo or none renders as a single image.
 */
export function CourtGallery({ court, photos }: Props) {
  const strip = useRef<HTMLUListElement>(null)
  const [index, setIndex] = useState(0)

  if (photos.length <= 1) return <CourtPhoto court={court} path={photos[0]?.path ?? null} />
  const total = photos.length
  // The list can shrink under an open gallery (a photo removed, then refetched): stay within it.
  const current = Math.min(index, total - 1)

  function show(next: number) {
    setIndex(next)
    const el = strip.current
    if (!el) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollTo?.({ left: next * el.clientWidth, behavior: reduce ? 'auto' : 'smooth' })
  }

  // Swiping scrolls the strip; keep the counter and buttons in step with it.
  function handleScroll() {
    const el = strip.current
    if (el && el.clientWidth) setIndex(Math.round(el.scrollLeft / el.clientWidth))
  }

  return (
    <div className="gallery" role="group" aria-label={`Photos of ${court.name}`}>
      {/* Focusable so keyboard users can scroll it too (axe scrollable-region-focusable). */}
      <ul ref={strip} className="gallery-strip" tabIndex={0} aria-label={`${court.name} photos, swipe or scroll`}
        onScroll={handleScroll}>
        {photos.map((photo, i) => (
          <li key={photo.id} className="gallery-item">
            <CourtPhoto court={court} path={photo.path} alt={`Photo ${i + 1} of ${total} of ${court.name}`} />
          </li>
        ))}
      </ul>
      <div className="gallery-controls">
        <button type="button" className="btn btn-outline icon-btn" aria-label={`Previous photo of ${court.name}`}
          disabled={current === 0} onClick={() => show(current - 1)}>
          <span aria-hidden="true">‹</span>
        </button>
        <span className="muted small" aria-live="polite">{current + 1} of {total}</span>
        <button type="button" className="btn btn-outline icon-btn" aria-label={`Next photo of ${court.name}`}
          disabled={current === total - 1} onClick={() => show(current + 1)}>
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  )
}
