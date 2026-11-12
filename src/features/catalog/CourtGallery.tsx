import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { PhotoViewer } from '../../components/PhotoViewer'
import type { Court, CourtPhotoRow } from './api'
import { CourtPhoto } from './CourtPhoto'
import { mediaUrl } from './media'

type Props = {
  court: Pick<Court, 'name' | 'sport'>
  photos: CourtPhotoRow[]
  /** Only the cover, as a plain image (the home page's tiles sit inside the sport card's link, T22.1b). */
  coverOnly?: boolean
}

const photoAlt = (name: string, i: number, total: number) => (total > 1 ? `Photo ${i + 1} of ${total} of ${name}` : `Photo of ${name}`)

/**
 * A court's photos as a swipeable strip (CSS scroll-snap, no library), with previous and next buttons and a
 * "2 / 4" counter for people who don't swipe (T9.7). Since T23.1 they sit on the photo, so every court tile is the
 * photo then its name; an arrow that can't be used is not rendered. One photo or none renders as a single image.
 * Tapping a photo opens it full screen (T9.11e).
 */
export function CourtGallery({ court, photos, coverOnly = false }: Props) {
  const strip = useRef<HTMLUListElement>(null)
  const prevBtn = useRef<HTMLButtonElement>(null)
  const nextBtn = useRef<HTMLButtonElement>(null)
  const [index, setIndex] = useState(0)
  const [viewing, setViewing] = useState<number | null>(null)
  const total = photos.length

  const viewer = viewing !== null && total > 0 && (
    <PhotoViewer
      photos={photos.map((p, i) => ({ src: mediaUrl(p.path), alt: photoAlt(court.name, i, total) }))}
      start={viewing}
      label={`Photos of ${court.name}`}
      onClose={(last) => {
        setViewing(null)
        if (total > 1) show(last) // the strip follows the viewer
      }}
    />
  )

  if (coverOnly) return <CourtPhoto court={court} path={photos[0]?.path ?? null} />

  if (total <= 1) {
    return (
      <>
        <CourtPhoto court={court} path={photos[0]?.path ?? null} onOpen={total ? () => setViewing(0) : undefined} />
        {viewer}
      </>
    )
  }
  // The list can shrink under an open gallery (a photo removed, then refetched): stay within it.
  const current = Math.min(index, total - 1)

  function show(next: number) {
    setIndex(next)
    const el = strip.current
    if (!el) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollTo?.({ left: next * el.clientWidth, behavior: reduce ? 'auto' : 'smooth' })
  }

  // A button press: the pressed arrow disappears at an end, so hand focus to the other one rather than <body>.
  function press(next: number) {
    flushSync(() => show(next))
    if (next === 0) nextBtn.current?.focus()
    else if (next === total - 1) prevBtn.current?.focus()
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
            <CourtPhoto court={court} path={photo.path} alt={photoAlt(court.name, i, total)} onOpen={() => setViewing(i)} />
          </li>
        ))}
      </ul>
      {/* On the photo, beside the full-screen buttons and never inside them. */}
      {current > 0 && (
        <button ref={prevBtn} type="button" className="gallery-arrow gallery-prev" aria-label={`Previous photo of ${court.name}`}
          onClick={() => press(current - 1)}>
          <ChevronLeft aria-hidden="true" />
        </button>
      )}
      {current < total - 1 && (
        <button ref={nextBtn} type="button" className="gallery-arrow gallery-next" aria-label={`Next photo of ${court.name}`}
          onClick={() => press(current + 1)}>
          <ChevronRight aria-hidden="true" />
        </button>
      )}
      <span className="gallery-count" aria-live="polite">{current + 1} / {total}</span>
      {viewer}
    </div>
  )
}
