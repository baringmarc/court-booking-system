import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { formatHour } from '../../lib/format'
import { addDays, formatDateLabel, hourInZone, todayInZone } from '../../lib/time'
import { SPORT_LABELS, type CourtWithPhotos, type PublicSchedulePeriod, type Sport, type VenueSettings } from '../catalog/api'
import { sportsOf } from '../catalog/sportOrder'
import { useCourts, usePublicSchedule, useVenueSettings } from '../catalog/hooks'
import { useUpcomingOpenPlay } from '../openPlay/hooks'
import { OpenPlayDialog } from '../openPlay/OpenPlayDialog'
import { CourtTiles } from '../catalog/CourtTiles'
import { joinNames } from './blocks'
import { toRunsSearch } from './checkoutParams'
import { useAvailability, usePlatformFee } from './hooks'
import {
  reconcileSelection, removeRun, selectionRuns, summarizeSelection, toggleSlot, TOO_MANY_RUNS_MESSAGE, type Selection, type Slot,
} from './selection'
import { SelectionBar } from './SelectionBar'
import { SlotGrid } from './SlotGrid'
import { DateStrip } from './DateStrip'

export function BookPage() {
  const settings = useVenueSettings()
  const courts = useCourts()
  const hours = usePublicSchedule()

  return (
    <section className="page">
      <h1>Book a court</h1>
      {settings.isPending || courts.isPending || hours.isPending ? (
        <PageLoader />
      ) : settings.isError ? (
        <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} />
      ) : courts.isError ? (
        <ErrorMessage error={courts.error} onRetry={() => courts.refetch()} />
      ) : courts.data.length === 0 ? (
        <p className="muted">No courts are open for booking right now.</p>
      ) : hours.isError ? (
        <ErrorMessage error={hours.error} onRetry={() => hours.refetch()} />
      ) : (
        <BookingBoard settings={settings.data} courts={courts.data} hours={hours.data} />
      )}
    </section>
  )
}

function clampDate(value: string | null, min: string, max: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return min
  return value < min ? min : value > max ? max : value
}

function BookingBoard({ settings, courts, hours }: { settings: VenueSettings; courts: CourtWithPhotos[]; hours: PublicSchedulePeriod[] }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [selection, setSelection] = useState<Selection>([])
  // A tap refused for the 6-run cap (T33.3); cleared by the next tap, Clear, or a date or sport change.
  const [refused, setRefused] = useState(false)
  const [openPlayId, setOpenPlayId] = useState<string | null>(null)

  const tz = settings.timezone
  // The operating day running now: at 1 AM after a 6 AM–5 AM day, that's still yesterday (T9.10).
  const today = hours.map((h) => h.booking_start).sort()[0] ?? todayInZone(tz)
  const lastDay = hours.map((h) => h.booking_end).sort().at(-1) ?? addDays(today, settings.booking_window_days)
  const date = clampDate(params.get('date'), today, lastDay)
  const sports = sportsOf(courts) // in the venue's sport order (fetchCourts sorts by it)
  const sportParam = params.get('sport')
  const sport: Sport = sports.find((s) => s === sportParam) ?? sports[0]
  const sportCourts = courts.filter((c) => c.sport === sport)

  const availability = useAvailability(date)
  const platformFee = usePlatformFee()
  // Session details are only fetched once the day has open play slots.
  const openPlay = useUpcomingOpenPlay({ enabled: !!availability.data?.some((s) => s.status === 'open_play') })

  const slotsByCourt = useMemo(() => {
    const map = new Map<string, Slot[]>()
    for (const slot of availability.data ?? []) {
      const period = hours.find((p) => p.court_id === slot.court_id && p.operating_date === date && Date.parse(p.period_start) <= Date.parse(slot.slot_start) && Date.parse(slot.slot_end) <= Date.parse(p.period_end))
      map.set(slot.court_id, [...(map.get(slot.court_id) ?? []), { ...slot, period_end: period?.period_end }])
    }
    return map
  }, [availability.data, hours, date])

  const times = useMemo(
    () => [...new Set(sportCourts.flatMap((c) => (slotsByCourt.get(c.id) ?? []).map((s) => s.slot_start)))].sort(),
    [sportCourts, slotsByCourt],
  )

  // A refetch can make picked slots unavailable; derive the live selection instead of syncing state. Only the taken
  // picks are dropped, and the page names them until the next change.
  const reconciled = availability.data ? reconcileSelection(selection, slotsByCourt) : { selection, dropped: [] }
  const activeSelection = reconciled.selection
  const summary = summarizeSelection(activeSelection, slotsByCourt)
  const courtName = (id: string) => courts.find((c) => c.id === id)?.name ?? ''
  const droppedNames = joinNames(reconciled.dropped.map((p) => `${courtName(p.courtId)} at ${formatHour(hourInZone(p.start, tz))}`))

  function update(next: { date?: string; sport?: Sport }) {
    const p = new URLSearchParams(params)
    if (next.date) p.set('date', next.date)
    if (next.sport) p.set('sport', next.sport)
    setParams(p, { replace: true })
    // Picks belong to one date; switching sport tabs keeps them (T33.3).
    if (next.date) setSelection([])
    setRefused(false)
  }

  function handleToggle(slot: Slot) {
    const result = toggleSlot(activeSelection, slot, slotsByCourt)
    setSelection(result.selection)
    setRefused(result.refused !== null)
  }

  function handleContinue() {
    const runs = selectionRuns(activeSelection, slotsByCourt).map((r) => ({ courtId: r.courtId, start: r.starts[0], slots: r.starts.length }))
    navigate(`/book/checkout?${toRunsSearch(runs)}`)
  }

  return (
    <div className="stack">
      <DateStrip value={date} today={today} lastDay={lastDay} closedDays={Array.from({ length: 7 }, (_, d) => d).filter((d) => !hours.some((h) => new Date(`${h.operating_date}T12:00:00Z`).getUTCDay() === d))}
        onChange={(d) => update({ date: clampDate(d, today, lastDay) })} />
      <div className="book-controls">
        {sports.length > 1 && (
          <div className="day-picker" role="group" aria-label="Sport">
            {sports.map((s) => (
              <button key={s} type="button" className={`day${s === sport ? ' on' : ''}`} aria-pressed={s === sport}
                onClick={() => update({ sport: s })}>
                {SPORT_LABELS[s]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Collapsed by default so the slot grid shows sooner on a phone (T27.6, replacing T9.11f's open); one tap opens it. */}
      <details className="court-info">
        <summary>About the {SPORT_LABELS[sport].toLowerCase()} courts</summary>
        <CourtTiles courts={sportCourts} detailed />
      </details>

      <p className="muted small">
        {formatDateLabel(date, tz)} · Tap a time to select it, and tap more times on any court to add them. Prices are per hour.
      </p>

      {reconciled.dropped.length > 0 && (
        <div className="alert alert-error" role="alert">
          <p>{`${droppedNames} ${reconciled.dropped.length === 1 ? 'is' : 'are'} no longer available. Please choose again.`}</p>
        </div>
      )}
      {refused && (
        <div className="alert alert-error" role="alert">
          <p>{TOO_MANY_RUNS_MESSAGE}</p>
        </div>
      )}

      {availability.isPending ? (
        <PageLoader />
      ) : availability.isError ? (
        <ErrorMessage error={availability.error} onRetry={() => availability.refetch()} />
      ) : times.length === 0 ? (
        <p className="muted">We're closed on this day. Please pick another date.</p>
      ) : (
        <SlotGrid
          courts={sportCourts}
          times={times}
          slotsByCourt={slotsByCourt}
          selection={activeSelection}
          onToggle={handleToggle}
          onOpenPlay={setOpenPlayId}
          timeZone={tz}
          currency={settings.currency}
          date={date}
        />
      )}

      {openPlayId && (
        <OpenPlayDialog
          sessionId={openPlayId}
          sessions={openPlay}
          courtName={(id) => courts.find((c) => c.id === id)?.name}
          timeZone={tz}
          onClose={() => setOpenPlayId(null)}
        />
      )}

      {summary && !availability.isError && (
        <SelectionBar
          summary={summary}
          courtName={courtName}
          date={todayInZone(tz, new Date(summary.runs[0].start))}
          timeZone={tz}
          currency={settings.currency}
          fee={platformFee.data ?? null}
          onRemoveRun={(run) => {
            const picked = selectionRuns(activeSelection, slotsByCourt).find((r) => r.courtId === run.courtId && r.starts[0] === run.start)
            if (picked) setSelection(removeRun(activeSelection, picked))
            setRefused(false)
          }}
          onClear={() => { setSelection([]); setRefused(false) }}
          onContinue={handleContinue}
        />
      )}
    </div>
  )
}
