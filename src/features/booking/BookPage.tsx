import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { addDays, formatDateLabel, todayInZone } from '../../lib/time'
import { SPORT_LABELS, SPORTS, type Court, type Sport, type VenueSettings } from '../catalog/api'
import { useCourts, useVenueSettings } from '../catalog/hooks'
import { CourtTiles } from '../catalog/CourtTiles'
import { toCheckoutSearch } from './checkoutParams'
import { useAvailability } from './hooks'
import { reconcileSelection, summarizeSelection, toggleSlot, type Selection, type Slot } from './selection'
import { SelectionBar } from './SelectionBar'
import { SlotGrid } from './SlotGrid'

export function BookPage() {
  const settings = useVenueSettings()
  const courts = useCourts()

  return (
    <section className="page">
      <h1>Book a court</h1>
      {settings.isPending || courts.isPending ? (
        <PageLoader />
      ) : settings.isError ? (
        <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} />
      ) : courts.isError ? (
        <ErrorMessage error={courts.error} onRetry={() => courts.refetch()} />
      ) : courts.data.length === 0 ? (
        <p className="muted">No courts are open for booking right now.</p>
      ) : (
        <BookingBoard settings={settings.data} courts={courts.data} />
      )}
    </section>
  )
}

function clampDate(value: string | null, min: string, max: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return min
  return value < min ? min : value > max ? max : value
}

function BookingBoard({ settings, courts }: { settings: VenueSettings; courts: Court[] }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [selection, setSelection] = useState<Selection>(null)

  const tz = settings.timezone
  const today = todayInZone(tz)
  const lastDay = addDays(today, settings.booking_window_days)
  const date = clampDate(params.get('date'), today, lastDay)
  const sports = SPORTS.filter((s) => courts.some((c) => c.sport === s))
  const sportParam = params.get('sport')
  const sport: Sport = sports.find((s) => s === sportParam) ?? sports[0]
  const sportCourts = courts.filter((c) => c.sport === sport)

  const availability = useAvailability(date)

  const slotsByCourt = useMemo(() => {
    const map = new Map<string, Slot[]>()
    for (const slot of availability.data ?? []) {
      map.set(slot.court_id, [...(map.get(slot.court_id) ?? []), slot])
    }
    return map
  }, [availability.data])

  const times = useMemo(
    () => [...new Set(sportCourts.flatMap((c) => (slotsByCourt.get(c.id) ?? []).map((s) => s.slot_start)))].sort(),
    [sportCourts, slotsByCourt],
  )

  // A refetch can make a selected slot unavailable; derive the live selection instead of syncing state.
  const selectedCourtSlots = selection ? slotsByCourt.get(selection.courtId) ?? [] : []
  const activeSelection = availability.data ? reconcileSelection(selection, selectedCourtSlots) : selection
  const lostSelection = selection !== null && activeSelection === null
  const summary = summarizeSelection(activeSelection, selectedCourtSlots)
  const selectedCourt = courts.find((c) => c.id === summary?.courtId)

  function update(next: { date?: string; sport?: Sport }) {
    const p = new URLSearchParams(params)
    if (next.date) p.set('date', next.date)
    if (next.sport) p.set('sport', next.sport)
    setParams(p, { replace: true })
    setSelection(null)
  }

  function handleToggle(slot: Slot) {
    setSelection(toggleSlot(activeSelection, slot, slotsByCourt.get(slot.court_id) ?? []))
  }

  return (
    <div className="stack">
      <div className="book-controls">
        <div className="date-nav">
          <button type="button" className="btn btn-small btn-outline" aria-label="Previous day"
            disabled={date <= today} onClick={() => update({ date: addDays(date, -1) })}>‹</button>
          <label>
            <span className="sr-only">Date</span>
            <input type="date" value={date} min={today} max={lastDay}
              onChange={(e) => e.target.value && update({ date: clampDate(e.target.value, today, lastDay) })} />
          </label>
          <button type="button" className="btn btn-small btn-outline" aria-label="Next day"
            disabled={date >= lastDay} onClick={() => update({ date: addDays(date, 1) })}>›</button>
        </div>
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

      <details className="court-info">
        <summary>About the {SPORT_LABELS[sport].toLowerCase()} courts</summary>
        <CourtTiles courts={sportCourts} showDescription />
      </details>

      <p className="muted small">
        {formatDateLabel(date, tz)} · Tap a time to select it, then tap more to extend. Prices are per hour.
      </p>

      {lostSelection && (
        <div className="alert alert-error" role="alert">
          <p>One of the slots you picked is no longer available. Please choose again.</p>
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
          timeZone={tz}
          currency={settings.currency}
        />
      )}

      {summary && selectedCourt && !availability.isError && (
        <SelectionBar
          summary={summary}
          courtName={selectedCourt.name}
          date={date}
          timeZone={tz}
          currency={settings.currency}
          onClear={() => setSelection(null)}
          onContinue={() =>
            navigate(`/book/checkout?${toCheckoutSearch({ courtId: summary.courtId, start: summary.start, slots: summary.slots })}`)
          }
        />
      )}
    </div>
  )
}
