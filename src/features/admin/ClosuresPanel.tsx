import { useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { DatePicker } from '../../components/DatePicker'
import { HourPicker } from '../../components/HourPicker'
import { calendarEndOptions, calendarHourOptions, findHour } from '../../components/pickerHours'
import { PageLoader } from '../../components/PageLoader'
import { ErrorMessage } from '../../components/ErrorMessage'
import { useCourts, useCreateBlackout, useDeleteBlackout, useUpcomingBlackouts, useVenueSettings } from '../catalog/hooks'
import type { Blackout } from '../catalog/api'
import { formatDateLabel, formatDateTimeInZone, todayInZone } from '../../lib/time'
import { useNow } from '../booking/useNow'
import { errorMessage } from '../../lib/errors'
import { adminKeys, fetchSchedule, type ScheduleData, type SchedulePeriod } from './api'
import { filtersToParams } from './bookingFilters'
import { closureRangeText, datesBetween, operatingDayRange, quickPickDates, type QuickPick } from './closures'
import { ConfirmDialog } from './ConfirmDialog'
import { useClosureConflicts, useSchedule } from './hooks'

const PICKS: [QuickPick | 'dates', string][] = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['weekend', 'This weekend'], ['dates', 'Pick dates']]
const REASONS = ['Holiday', 'Maintenance', 'Private event']

/**
 * The Closures tab (T17.33). A closure is a blackout row, saved as soon as it is added and apart from the hours draft.
 * All day closes each date's whole operating day for the chosen courts; the summary warns about bookings and open play
 * already in that time, which stay booked.
 */
export function ClosuresPanel() {
  const courts = useCourts({ includeInactive: true })
  const settings = useVenueSettings()
  const schedule = useSchedule()
  const blackouts = useUpcomingBlackouts()
  const remove = useDeleteBlackout()
  const timeZone = settings.data?.timezone ?? 'Asia/Manila'
  const [removing, setRemoving] = useState<{ closure: Blackout; opener: HTMLElement } | null>(null)
  const listTitle = useRef<HTMLHeadingElement>(null)

  const courtName = (id: string | null) =>
    id ? courts.data?.find((c) => c.id === id)?.name ?? 'Unknown court' : 'All courts'

  function keep() {
    removing?.opener.focus()
    setRemoving(null)
  }
  function confirmRemove() {
    if (!removing) return
    remove.mutate(removing.closure.id)
    setRemoving(null)
    listTitle.current?.focus()
  }

  return (
    <section className="card stack">
      <div>
        <h2>Closures</h2>
        <p className="muted small">Close a court, or the whole venue, for a holiday, maintenance or an event. Times are in {timeZone}.</p>
      </div>

      <ClosureForm courts={courts.data ?? []} schedule={schedule.data} timeZone={timeZone} />
      {schedule.isError && <p className="muted small">Couldn't load the opening hours, so All day can't close them yet. Untick All day to choose hours.</p>}

      <h3 ref={listTitle} tabIndex={-1}>Upcoming closures</h3>
      {blackouts.isPending ? (
        <PageLoader />
      ) : blackouts.isError ? (
        <ErrorMessage error={blackouts.error} onRetry={() => blackouts.refetch()} />
      ) : blackouts.data.length === 0 ? (
        <p className="muted">No upcoming closures.</p>
      ) : (
        <ul className="list">
          {blackouts.data.map((b) => (
            <li key={b.id} className="list-row">
              <span>
                <strong>{courtName(b.court_id)}</strong>
                <span className="block small">
                  {formatDateTimeInZone(b.starts_at, timeZone)} → {formatDateTimeInZone(b.ends_at, timeZone)}
                </span>
                {b.reason && <span className="block small muted">{b.reason}</span>}
              </span>
              <button type="button" className="btn btn-small btn-ghost" disabled={remove.isPending} aria-label={`Remove closure: ${courtName(b.court_id)}`}
                onClick={(e) => setRemoving({ closure: b, opener: e.currentTarget })}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {remove.error && <p className="form-error" role="alert">{errorMessage(remove.error)}</p>}

      {removing && (
        <ConfirmDialog id="remove-closure" title="Remove this closure?" body="The time will become bookable again."
          stay="Keep closure" confirm="Remove closure" onStay={keep} onConfirm={confirmRemove} />
      )}
    </section>
  )
}

/** Each court's effective weekly periods: its own when it has different hours, else the venue's. */
function weeklyOf(schedule: ScheduleData, courtId: string): SchedulePeriod[] {
  const court = schedule.courts.find((c) => c.court_id === courtId)
  return court?.schedule_mode === 'custom' ? court.periods : schedule.venue_periods
}

/** Each chosen date's operating day for one court (its id) or every court (''). */
function operatingDays(schedule: ScheduleData | undefined, courtId: string, dates: string[], timeZone: string) {
  const weekly = !schedule ? []
    : courtId ? [weeklyOf(schedule, courtId)]
    : schedule.courts.length > 0 ? schedule.courts.map((c) => weeklyOf(schedule, c.court_id)) : [schedule.venue_periods]
  return dates.map((date) => ({ date, range: operatingDayRange(date, weekly, timeZone) }))
}

function ClosureForm({ courts, schedule, timeZone }: {
  courts: { id: string; name: string }[]
  /** The weekly hours; undefined while they load. */
  schedule: ScheduleData | undefined
  timeZone: string
}) {
  const qc = useQueryClient()
  const create = useCreateBlackout()
  const now = useNow(60_000)
  const today = todayInZone(timeZone, now)

  const [pick, setPick] = useState<QuickPick | 'dates'>('today')
  const [pickedFrom, setPickedFrom] = useState(today)
  const [pickedTo, setPickedTo] = useState(today)
  const [courtId, setCourtId] = useState('')
  const [allDay, setAllDay] = useState(true)
  const [from, setFrom] = useState<string | null>(null)
  const [until, setUntil] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const reasonInput = useRef<HTMLInputElement>(null)

  // Derived, not synced: picked dates before today move up to today (the page stayed open past midnight), and the
  // end date is never before the start date.
  const quick = pick === 'dates' ? null : quickPickDates(pick, today)
  const fromDate = quick?.from ?? (pickedFrom < today ? today : pickedFrom)
  const toDate = quick?.to ?? (pickedTo < fromDate ? fromDate : pickedTo)

  // All day: each date's operating day over the chosen court, or every court for All courts.
  const dates = datesBetween(fromDate, toDate)
  const days = operatingDays(schedule, courtId, dates, timeZone)
  const ranges = days.flatMap((d) => (d.range ? [d.range] : []))

  // Timed: hours that have ended aren't offered, and the end comes after the start (T10.3).
  const fromOptions = calendarHourOptions(fromDate, timeZone).filter((o) => Date.parse(o.start) + 3_600_000 > now.getTime())
  const chosenFrom = findHour(fromOptions, from)?.start ?? null
  const untilOptions = calendarEndOptions(toDate, timeZone)
    .filter((o) => Date.parse(o.start) > (chosenFrom ? Date.parse(chosenFrom) : now.getTime()))
  const chosenUntil = findHour(untilOptions, until)?.start ?? null

  const span = allDay
    ? ranges.length > 0 ? { start: ranges[0].start, end: ranges[ranges.length - 1].end } : null
    : chosenFrom && chosenUntil ? { start: chosenFrom, end: chosenUntil } : null
  const conflicts = useClosureConflicts(span && { ...span, courtId: courtId || null })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    let writes: { start: string; end: string }[]
    if (allDay) {
      // Pressed before the hours loaded: wait for them rather than closing nothing.
      const loaded = schedule ?? await qc.ensureQueryData({ queryKey: adminKeys.schedule(), queryFn: fetchSchedule }).catch(() => undefined)
      writes = operatingDays(loaded, courtId, dates, timeZone).flatMap((d) => (d.range ? [d.range] : []))
      setProblem(!loaded ? "Couldn't load the opening hours. Try again." : writes.length === 0 ? 'Nobody is open on these dates, so there is nothing to close.' : null)
    } else {
      setProblem(!chosenFrom ? 'Choose when the closure starts.' : !chosenUntil ? 'Choose when it ends.' : null)
      writes = chosenFrom && chosenUntil ? [{ start: chosenFrom, end: chosenUntil }] : []
    }
    if (writes.length === 0) return
    try {
      for (const w of writes) {
        await create.mutateAsync({ court_id: courtId || null, starts_at: w.start, ends_at: w.end, reason: reason.trim() })
      }
    } catch {
      return // the mutation's error is shown under the button
    }
    setFrom(null)
    setUntil(null)
    setReason('')
  }

  const bookingLink = (id: string, start: string) => {
    const params = filtersToParams({ status: 'all', source: 'all', date: todayInZone(timeZone, new Date(start)), q: '', sort: null })
    params.set('booking', id)
    return `/admin/bookings?${params}`
  }
  const found = conflicts.data
  const anyFound = !!found && found.bookings.length + found.sessions.length > 0

  return (
    <form className="stack" onSubmit={(e) => void handleSubmit(e)}>
      <div className="choice-chips" role="group" aria-label="Which days">
        {PICKS.map(([key, label]) => (
          <button key={key} type="button" className="btn btn-small btn-outline" aria-pressed={pick === key} onClick={() => setPick(key)}>
            {label}
          </button>
        ))}
      </div>
      {pick === 'dates' && (
        <div className="form-grid">
          <DatePicker label="Starts on" value={fromDate} onChange={setPickedFrom} today={today} min={today} timeZone={timeZone} />
          <DatePicker label="Ends on" value={toDate} onChange={setPickedTo} today={today} min={fromDate} timeZone={timeZone} />
        </div>
      )}

      <div className="form-grid">
        <label className="field">
          <span>Court</span>
          <select value={courtId} onChange={(e) => setCourtId(e.target.value)}>
            <option value="">All courts</option>
            {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>

      <label className="check">
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
        All day
      </label>
      {!allDay && (
        <>
          <HourPicker label="Starts at" options={fromOptions} value={chosenFrom} onChange={setFrom} empty="No hours left on this day." />
          <HourPicker label="Ends at" options={untilOptions} value={chosenUntil} onChange={setUntil} empty="Pick a later day to end on." />
        </>
      )}

      <div className="stack-sm">
        <div className="choice-chips" role="group" aria-label="Reason">
          {REASONS.map((r) => (
            <button key={r} type="button" className="btn btn-small btn-outline" onClick={() => setReason(r)}>{r}</button>
          ))}
          <button type="button" className="btn btn-small btn-outline" onClick={() => { setReason(''); reasonInput.current?.focus() }}>Other</button>
        </div>
        <label className="field">
          <span>Reason (staff only)</span>
          <input ref={reasonInput} value={reason} placeholder="e.g. Floor maintenance" aria-describedby="closure-reason-hint"
            onChange={(e) => setReason(e.target.value)} />
        </label>
        <p id="closure-reason-hint" className="muted small">Players only see “Closed”.</p>
      </div>

      <div className="closure-summary stack-sm" role="status" aria-label="Closure summary">
        <ul className="plain-list">
          {allDay && !schedule && <li className="muted">Checking opening hours…</li>}
          {allDay
            ? schedule && days.map(({ date, range }) => (
              <li key={date}>{range ? closureRangeText(range.start, range.end, timeZone) : `${formatDateLabel(date, timeZone)}: Closed all day already.`}</li>
            ))
            : <li>{span ? closureRangeText(span.start, span.end, timeZone) : 'Choose the start and end hours.'}</li>}
        </ul>
        {span && conflicts.isPending && <p className="muted small">Checking bookings…</p>}
        {conflicts.isError && <p className="muted small">Couldn't check bookings in this time. You can still add the closure.</p>}
        {found && !anyFound && <p className="muted small">No bookings or open play in this time.</p>}
        {found && anyFound && (
          <div className="stack-sm">
            <h4>Already booked in this time</h4>
            <ul className="plain-list">
              {found.bookings.map((b) => (
                <li key={b.id}>
                  <Link to={bookingLink(b.id, b.slot_start)}>
                    {`${b.reference_code} · ${b.court_name} · ${closureRangeText(b.slot_start, b.slot_end, timeZone)}`}
                  </Link>
                </li>
              ))}
              {found.sessions.map((s) => (
                <li key={s.id}>
                  <Link to="/admin/open-play">{`Open play: ${s.title} · ${closureRangeText(s.starts_at, s.ends_at, timeZone)}`}</Link>
                </li>
              ))}
            </ul>
            <p className="small">They stay booked. Nothing is cancelled or moved.</p>
          </div>
        )}
      </div>

      <div className="form-actions">
        <button type="submit" className="btn" disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add closure'}</button>
        {(problem || create.error) && <span className="form-error" role="alert">{problem ?? errorMessage(create.error)}</span>}
      </div>
    </form>
  )
}
