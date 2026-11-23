import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChoiceGroup } from '../../components/ChoiceGroup'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { errorMessage } from '../../lib/errors'
import { DEFAULT_THEME, isThemePreset, THEME_SWATCHES } from '../../lib/themes'
import { addDays, formatDateLabel, formatInZone } from '../../lib/time'
import { venueBookUrl } from '../../lib/venueUrl'
import { useAvailability } from '../booking/hooks'
import { useNow } from '../booking/useNow'
import type { Court, VenueSettings } from '../catalog/api'
import { mediaUrl } from '../catalog/media'
import { useVenue } from '../venue/useVenue'
import { buildCaption, buildCourtRanges, renderSlotsImage, slotsImageFileName, type SlotsImageInput } from './slotsImage'

type Day = 'today' | 'tomorrow'
type Drawn = { input: SlotsImageInput; url: string } | { input: SlotsImageInput; error: string }

/** "10:30 AM" in the venue's time zone. */
function clockLabel(now: Date, timeZone: string) {
  const [h, m] = formatInZone(now.toISOString(), timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

type Props = { settings: VenueSettings; courts: Court[]; today: string; onClose: () => void }

/**
 * "Post your open courts" (T31.1, T31.1b): today's (the operating day) or tomorrow's free ranges per court as a
 * 1080×1350 picture, previewed here, to download and post on Facebook with the caption beside it. A native modal
 * <dialog>: the browser traps focus and closes it on Escape; focus goes back to the button that opened it.
 */
export function PostOpenSlotsDialog({ settings, courts, today, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const captionId = useId()
  // Whatever had focus before the first render (the Post open slots button), so a StrictMode re-run can't swap it.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))
  const venue = useVenue()
  const now = useNow(30_000)
  const [day, setDay] = useState<Day>('today')
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [drawn, setDrawn] = useState<Drawn | null>(null)
  const urlRef = useRef<string | null>(null)
  const copiedTimer = useRef<number | undefined>(undefined)

  const tz = settings.timezone
  const tomorrow = addDays(today, 1)
  const date = day === 'today' ? today : tomorrow
  const isToday = day === 'today'
  const availability = useAvailability(date)
  const asOf = isToday ? clockLabel(now, tz) : null
  const slug = venue.slug
  const { name, logo_path: logoPath, theme } = settings

  // One input for the picture and the caption, so they always match. Rebuilt only when what it shows changes.
  const input = useMemo<SlotsImageInput | null>(() => {
    if (!availability.data) return null
    const preset = isThemePreset(theme) ? theme : DEFAULT_THEME
    return {
      venueName: name.trim(),
      logoUrl: logoPath ? mediaUrl(logoPath) : null,
      dateLabel: formatDateLabel(date, tz),
      isToday,
      asOf,
      courts: buildCourtRanges(courts, availability.data, date, tz, now),
      address: venueBookUrl(slug, window.location),
      palette: THEME_SWATCHES[preset].light,
    }
    // `now` only matters through `asOf` and the started-hours cut, which the minute label tracks closely enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availability.data, courts, date, tz, isToday, asOf, name, logoPath, theme, slug])
  const caption = input ? buildCaption(input) : ''

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      window.clearTimeout(copiedTimer.current)
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      opener?.focus()
    }
  }, [opener])

  // Draw the preview whenever its input changes; a newer drawing replaces (and frees) the older one.
  useEffect(() => {
    if (!input) return
    let current = true
    renderSlotsImage(input).then(
      (png) => {
        if (!current) return
        const url = URL.createObjectURL(png)
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = url
        setDrawn({ input, url })
      },
      (error: unknown) => { if (current) setDrawn({ input, error: errorMessage(error) }) },
    )
    return () => { current = false }
  }, [input])

  const ready = drawn && input && drawn.input === input ? drawn : null
  const picture = ready && 'url' in ready ? ready.url : null
  const alt = `Open slots ${isToday ? 'today' : 'tomorrow'} at ${name.trim()}, ${formatDateLabel(date, tz)}`

  function choose(next: Day) {
    setDay(next)
    setCopied(false)
    setCopyFailed(false)
  }

  function download() {
    if (!picture) return
    const link = document.createElement('a')
    link.href = picture
    link.download = slotsImageFileName(slug, date)
    document.body.append(link)
    link.click()
    link.remove()
  }

  async function copyCaption() {
    setCopyFailed(false)
    try {
      await navigator.clipboard.writeText(caption)
      setCopied(true)
      window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(false), 3000)
    } catch {
      setCopyFailed(true)
    }
  }

  return (
    // A click on the backdrop lands on the <dialog> itself (its content is inside .dialog-body): close then.
    <dialog ref={ref} className="dialog post-dialog" aria-labelledby={titleId} onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close() }}>
      <div className="dialog-body stack">
        <div className="post-head">
          <h2 id={titleId}>Post your open courts</h2>
          <button type="button" className="btn btn-outline icon-btn" aria-label="Close" onClick={() => ref.current?.close()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <p className="muted">A picture of every court's free times, and a caption with your booking link. Post them together on Facebook or Messenger.</p>
        <ChoiceGroup label="Day" value={day} onChange={choose} choices={[
          { value: 'today', label: `Today · ${formatDateLabel(today, tz)}` },
          { value: 'tomorrow', label: `Tomorrow · ${formatDateLabel(tomorrow, tz)}` },
        ]} />
        <div className="post-grid">
          <div className="stack">
            <div className="post-preview">
              {availability.isPending ? <PageLoader /> : availability.isError ? (
                <ErrorMessage error={availability.error} onRetry={() => availability.refetch()} />
              ) : picture ? (
                <img src={picture} alt={alt} width={1080} height={1350} />
              ) : ready && 'error' in ready ? (
                <p className="alert alert-error" role="alert">{ready.error}</p>
              ) : (
                <p className="muted small" role="status">Drawing the picture…</p>
              )}
            </div>
            <p className="muted small touch-only">Press and hold the picture to save it to Photos.</p>
          </div>
          <div className="field post-caption">
            <label htmlFor={captionId}>Caption</label>
            <textarea id={captionId} readOnly rows={12} value={caption} />
          </div>
        </div>
        <div className="form-actions post-actions">
          <button type="button" className="btn" disabled={!picture} onClick={download}>Download picture</button>
          <button type="button" className="btn btn-outline" disabled={!input} onClick={copyCaption}>
            {copied ? 'Copied' : 'Copy caption'}
          </button>
        </div>
        {copyFailed && <p className="alert alert-error" role="alert">The caption couldn't be copied. Select the text above and copy it instead.</p>}
      </div>
    </dialog>
  )
}
