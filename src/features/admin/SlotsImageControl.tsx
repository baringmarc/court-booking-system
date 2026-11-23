import { useMemo, useRef, useState } from 'react'
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
import { buildCaption, buildCourtRanges, renderSlotsImage, slotsImageFileName } from './slotsImage'

type Day = 'today' | 'tomorrow'
const DAYS = [{ value: 'today' as const, label: 'Today' }, { value: 'tomorrow' as const, label: 'Tomorrow' }]

/** "10:30 AM" in the venue's time zone. */
function clockLabel(now: Date, timeZone: string) {
  const [h, m] = formatInZone(now.toISOString(), timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** Whether this browser's share sheet takes image files (phones do; most desktops don't). */
function canShareFiles(fileName: string) {
  if (typeof navigator.canShare !== 'function') return false
  try {
    return navigator.canShare({ files: [new File([], fileName, { type: 'image/png' })] })
  } catch {
    return false
  }
}

/**
 * The open slots picture for Facebook (T31.1) on the Today's courts card: today's (the operating day) or tomorrow's
 * free ranges per court as a 1080×1350 PNG to download or share, and the same ranges as a caption to copy.
 */
export function SlotsImageControl({ settings, courts, today }: { settings: VenueSettings; courts: Court[]; today: string }) {
  const venue = useVenue()
  const now = useNow(30_000)
  const [day, setDay] = useState<Day>('today')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<number | undefined>(undefined)
  const date = day === 'today' ? today : addDays(today, 1)
  const availability = useAvailability(date)
  const tz = settings.timezone
  const fileName = slotsImageFileName(venue.slug, date)
  const shareable = useMemo(() => canShareFiles(fileName), [fileName])

  function choose(next: Day) {
    setDay(next)
    setFailure(null)
    setCopied(false)
  }

  function details() {
    const isToday = day === 'today'
    return {
      venueName: settings.name.trim(),
      dateLabel: formatDateLabel(date, tz),
      isToday,
      courts: buildCourtRanges(courts, availability.data ?? [], date, tz, now),
      address: venueBookUrl(venue.slug, window.location),
      asOf: isToday ? clockLabel(now, tz) : null,
    }
  }

  async function makeImage() {
    const preset = isThemePreset(settings.theme) ? settings.theme : DEFAULT_THEME
    return renderSlotsImage({
      ...details(),
      logoUrl: settings.logo_path ? mediaUrl(settings.logo_path) : null,
      palette: THEME_SWATCHES[preset].light,
    })
  }

  async function run(action: (png: Blob) => Promise<void> | void) {
    setBusy(true)
    setFailure(null)
    try {
      await action(await makeImage())
    } catch (error) {
      // Closing the share sheet without sharing isn't a failure.
      if (!(error instanceof DOMException && error.name === 'AbortError')) setFailure(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const download = () => run((png) => {
    const url = URL.createObjectURL(png)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  })

  const share = () => run((png) => navigator.share({ files: [new File([png], fileName, { type: 'image/png' })] }))

  async function copyCaption() {
    setFailure(null)
    try {
      await navigator.clipboard.writeText(buildCaption(details()))
      setCopied(true)
      window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(false), 3000)
    } catch {
      setFailure("The caption couldn't be copied. Download the image and type the times instead.")
    }
  }

  const ready = !availability.isPending && !availability.isError

  return (
    <div className="slots-image stack">
      <ChoiceGroup label="Slots image" choices={DAYS} value={day} onChange={choose} />
      <p className="muted small">A picture of each court's open times to post on Facebook, with a caption to copy.</p>
      {availability.isPending ? <PageLoader /> : availability.isError ? (
        <ErrorMessage error={availability.error} onRetry={() => availability.refetch()} />
      ) : null}
      <div className="form-actions">
        <button type="button" className="btn btn-small" disabled={!ready || busy} onClick={download}>Download image</button>
        {shareable && (
          <button type="button" className="btn btn-small btn-outline" disabled={!ready || busy} onClick={share}>Share</button>
        )}
        <button type="button" className="btn btn-small btn-outline" disabled={!ready} onClick={copyCaption}>
          {copied ? 'Copied' : 'Copy caption'}
        </button>
      </div>
      {failure && <p className="alert alert-error" role="alert">{failure}</p>}
    </div>
  )
}
