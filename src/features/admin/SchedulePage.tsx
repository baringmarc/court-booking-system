import { useState, type FormEvent, type ReactNode } from 'react'
import { DatePicker } from '../../components/DatePicker'
import { HourPicker } from '../../components/HourPicker'
import { calendarEndOptions, calendarHourOptions, findHour } from '../../components/pickerHours'
import { PageLoader } from '../../components/PageLoader'
import { ErrorMessage } from '../../components/ErrorMessage'
import { SaveStatus } from '../../components/SaveStatus'
import {
  useCourts,
  useCreateBlackout,
  useDeleteBlackout,
  useOperatingHours,
  useSaveOperatingHours,
  useUpcomingBlackouts,
  useVenueSettings,
} from '../catalog/hooks'
import type { OperatingHours } from '../catalog/api'
import { DAY_NAMES, DISPLAY_DAY_ORDER, formatHour, hourOf, hourToTime } from '../../lib/format'
import { findOverlap, findSameTime, isAllDay, isOvernight, overlapMessage, sameTimeMessage } from '../catalog/hours'
import { formatDateTimeInZone, todayInZone } from '../../lib/time'
import { useNow } from '../booking/useNow'
import { errorMessage } from '../../lib/errors'

export function SchedulePage() {
  const hours = useOperatingHours()
  const save = useSaveOperatingHours()

  return (
    <section className="page">
      <h1>Schedule</h1>

      <section className="card stack">
        <h2>Operating hours</h2>
        {hours.isPending ? (
          <PageLoader />
        ) : hours.isError ? (
          <ErrorMessage error={hours.error} onRetry={() => hours.refetch()} />
        ) : (
          <HoursForm
            key={hours.dataUpdatedAt}
            initial={hours.data}
            saving={save.isPending}
            status={<SaveStatus isSuccess={save.isSuccess} error={save.error} />}
            onSave={(rows) => save.mutate(rows)}
          />
        )}
      </section>

      <BlackoutsSection />
    </section>
  )
}

const OPEN_HOURS = Array.from({ length: 24 }, (_, i) => i) // 0–23
const CLOSE_HOURS = Array.from({ length: 24 }, (_, i) => i + 1) // 1–24

function HoursForm({
  initial,
  saving,
  status,
  onSave,
}: {
  initial: OperatingHours[]
  saving: boolean
  status: ReactNode
  onSave: (rows: OperatingHours[]) => void
}) {
  const [rows, setRows] = useState(initial)
  const update = (day: number, patch: Partial<OperatingHours>) =>
    setRows((rs) => rs.map((r) => (r.day_of_week === day ? { ...r, ...patch } : r)))

  // A close before the open means the next day (T9.9). What can't happen: closing at the opening time (24 hours is
  // 12 AM to midnight only) or running into the next day.
  const sameTime = findSameTime(rows)
  const overlap = findOverlap(rows)
  const error = sameTime !== null ? sameTimeMessage(sameTime) : overlap ? overlapMessage(overlap) : null

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!error) onSave(rows)
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <div className="hours-rows">
        {DISPLAY_DAY_ORDER.map((day) => {
          const row = rows.find((r) => r.day_of_week === day)
          if (!row) return null
          return (
            <div key={day} className="hours-row">
              <span className="hours-day">{DAY_NAMES[day]}</span>
              <label className="check">
                <input type="checkbox" checked={row.is_closed} onChange={(e) => update(day, { is_closed: e.target.checked })} />
                <span>Closed</span>
              </label>
              <select
                aria-label={`${DAY_NAMES[day]} opens`}
                disabled={row.is_closed}
                value={hourOf(row.open_time)}
                onChange={(e) => update(day, { open_time: hourToTime(Number(e.target.value)) })}
              >
                {OPEN_HOURS.map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
              </select>
              <span className="muted">to</span>
              <select
                aria-label={`${DAY_NAMES[day]} closes`}
                disabled={row.is_closed}
                value={hourOf(row.close_time)}
                onChange={(e) => update(day, { close_time: hourToTime(Number(e.target.value)) })}
              >
                {CLOSE_HOURS.map((h) => <option key={h} value={h}>{h === 24 ? 'Midnight' : formatHour(h)}</option>)}
              </select>
              {!row.is_closed && isAllDay(row) && <span className="muted small">open 24 hours</span>}
              {!row.is_closed && isOvernight(row) && <span className="muted small">closes next day</span>}
            </div>
          )
        })}
      </div>
      <p className="muted small">
        A closing time before the opening time means the venue closes the next morning. For 24 hours, open at 12 AM and
        close at midnight.
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn" disabled={saving || !!error}>{saving ? 'Saving…' : 'Save hours'}</button>
        {status}
      </div>
    </form>
  )
}

function BlackoutsSection() {
  const blackouts = useUpcomingBlackouts()
  const courts = useCourts({ includeInactive: true })
  const settings = useVenueSettings()
  const create = useCreateBlackout()
  const remove = useDeleteBlackout()
  const timeZone = settings.data?.timezone ?? 'Asia/Manila'
  const now = useNow(60_000)
  const today = todayInZone(timeZone, now)

  // Blackouts can span days and cover closed time, so they use calendar dates and all 24 hours (T10.3).
  const [courtId, setCourtId] = useState('')
  const [pickedFromDate, setFromDate] = useState(today)
  const [from, setFrom] = useState<string | null>(null)
  const [untilDate, setUntilDate] = useState(today)
  const [until, setUntil] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  // Derived, not synced: a start day before today moves up to today, hours that have ended drop out, the end day is never before the start day, and an end that
  // isn't after the start drops out.
  const fromDate = pickedFromDate < today ? today : pickedFromDate // the page stayed open past midnight
  const fromOptions = calendarHourOptions(fromDate, timeZone).filter((o) => Date.parse(o.start) + 3_600_000 > now.getTime())
  const chosenFrom = findHour(fromOptions, from)?.start ?? null
  const untilDay = untilDate < fromDate ? fromDate : untilDate
  const untilOptions = calendarEndOptions(untilDay, timeZone)
    .filter((o) => Date.parse(o.start) > (chosenFrom ? Date.parse(chosenFrom) : now.getTime()))
  const chosenUntil = findHour(untilOptions, until)?.start ?? null

  const courtName = (id: string | null) =>
    id ? courts.data?.find((c) => c.id === id)?.name ?? 'Unknown court' : 'All courts'

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const next = !chosenFrom ? 'Choose when the blackout starts.' : !chosenUntil ? 'Choose when it ends.' : null
    setProblem(next)
    if (!chosenFrom || !chosenUntil) return
    create.mutate(
      { court_id: courtId || null, starts_at: chosenFrom, ends_at: chosenUntil, reason: reason.trim() },
      {
        onSuccess: () => {
          setFrom(null)
          setUntil(null)
          setReason('')
        },
      },
    )
  }

  function handleDelete(id: string) {
    if (window.confirm('Remove this blackout? The time will become bookable again.')) remove.mutate(id)
  }

  return (
    <section className="card stack">
      <div>
        <h2>Blackouts</h2>
        <p className="muted small">Block a court (or the whole venue) for maintenance, events or holidays. Times are in {timeZone}.</p>
      </div>

      <form className="stack" onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="field">
            <span>Court</span>
            <select value={courtId} onChange={(e) => setCourtId(e.target.value)}>
              <option value="">All courts</option>
              {courts.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Reason</span>
            <input value={reason} placeholder="e.g. Floor maintenance" onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
        <DatePicker label="Starts on" value={fromDate} onChange={setFromDate} today={today} min={today} timeZone={timeZone} />
        <HourPicker label="Starts at" options={fromOptions} value={chosenFrom} onChange={setFrom} empty="No hours left on this day." />
        <DatePicker label="Ends on" value={untilDay} onChange={setUntilDate} today={today} min={fromDate} timeZone={timeZone} />
        <HourPicker label="Ends at" options={untilOptions} value={chosenUntil} onChange={setUntil}
          empty="Pick a later day to end on." />
        <div className="form-actions">
          <button type="submit" className="btn" disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add blackout'}</button>
          {(problem || create.error) && <span className="form-error" role="alert">{problem ?? errorMessage(create.error)}</span>}
        </div>
      </form>

      {blackouts.isPending ? (
        <PageLoader />
      ) : blackouts.isError ? (
        <ErrorMessage error={blackouts.error} onRetry={() => blackouts.refetch()} />
      ) : blackouts.data.length === 0 ? (
        <p className="muted">No upcoming blackouts.</p>
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
              <button type="button" className="btn btn-small btn-ghost" disabled={remove.isPending} onClick={() => handleDelete(b.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {remove.error && <p className="form-error" role="alert">{errorMessage(remove.error)}</p>}
    </section>
  )
}
