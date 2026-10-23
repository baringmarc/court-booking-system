import { useEffect, useRef, useState, type KeyboardEvent, type TouchEvent } from 'react'

export type ViewerPhoto = { src: string; alt: string }

type Props = {
  photos: ViewerPhoto[]
  /** The photo to open on. */
  start: number
  /** The dialog's accessible name, e.g. "Photos of Court 1". */
  label: string
  /** Called with the photo on screen when the viewer closes (a gallery can scroll to it). */
  onClose: (index: number) => void
}

const SWIPE_PX = 40

/**
 * A full-screen photo viewer (T9.11e) in a native modal <dialog>: the browser traps focus, and Escape closes it.
 * The whole image shows (object-fit: contain); pinch zoom is left to the browser. Previous and next buttons, the
 * arrow keys and a one-finger swipe move between photos, with a "2 of 4" counter. Focus returns to the opener.
 */
export function PhotoViewer({ photos, start, label, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [index, setIndex] = useState(Math.max(start, 0))
  const [failed, setFailed] = useState<string | null>(null)
  // Whatever had focus before the first render (the photo), so a StrictMode re-run can't swap in the dialog's button.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))
  const touchX = useRef<number | null>(null)
  const total = photos.length
  // The list can shrink while the viewer is open (a photo removed, then refetched): stay within it.
  const current = Math.min(index, total - 1)
  const photo = photos[current]

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => opener?.focus()
  }, [opener])

  const go = (next: number) => setIndex(Math.min(Math.max(next, 0), total - 1))

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') go(current + 1)
    else if (e.key === 'ArrowLeft') go(current - 1)
    else if (e.key === 'Escape') {
      e.preventDefault() // close once, here, rather than through the browser's cancel as well
      ref.current?.close()
    }
  }

  function handleTouchStart(e: TouchEvent) {
    touchX.current = e.touches.length === 1 ? e.touches[0].clientX : null // two fingers: a pinch, not a swipe
  }

  function handleTouchEnd(e: TouchEvent) {
    const from = touchX.current
    touchX.current = null
    if (from === null || e.changedTouches.length !== 1) return
    const dx = e.changedTouches[0].clientX - from
    if (Math.abs(dx) >= SWIPE_PX) go(dx < 0 ? current + 1 : current - 1)
  }

  if (!photo) return null // every photo was removed while it was open
  return (
    // tabIndex -1: a click on the image or the background keeps focus inside, so the arrow keys still work.
    <dialog ref={ref} className="viewer" aria-label={label} tabIndex={-1} onClose={() => onClose(current)} onKeyDown={handleKeyDown}>
      <div className="viewer-bar">
        {total > 1 ? <span aria-live="polite">{current + 1} of {total}</span> : <span />}
        <button type="button" className="viewer-btn" onClick={() => ref.current?.close()}>Close</button>
      </div>
      <div className="viewer-stage" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {failed === photo.src ? (
          <p className="viewer-error">This photo couldn't be loaded.</p>
        ) : (
          <img key={photo.src} className="viewer-img" src={photo.src} alt={photo.alt} decoding="async"
            onError={() => setFailed(photo.src)} />
        )}
      </div>
      {total > 1 && (
        <div className="viewer-nav">
          <button type="button" className="viewer-btn" aria-label="Previous photo" disabled={current === 0} onClick={() => go(current - 1)}>
            <span aria-hidden="true">‹</span>
          </button>
          <button type="button" className="viewer-btn" aria-label="Next photo" disabled={current === total - 1} onClick={() => go(current + 1)}>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      )}
    </dialog>
  )
}
