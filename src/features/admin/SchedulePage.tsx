import { useState, type FormEvent, type ReactNode } from 'react'
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
import { findOverlap, isAllDay, isOvernight, overlapMessage } from '../catalog/hours'
import { formatDateTimeInZone, zonedLocalToISO } from '../../lib/time'
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

  // A close at or before the open means the next day (T9.9); what can't happen is running into the next day.
  const overlap = findOverlap(rows)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!overlap) onSave(rows)
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
                disabled={row.is_closed || isAllDay(row)}
                value={hourOf(row.close_time)}
                onChange={(e) => update(day, { close_time: hourToTime(Number(e.target.value)) })}
              >
                {CLOSE_HOURS.map((h) => <option key={h} value={h}>{h === 24 ? 'Midnight' : formatHour(h)}</option>)}
              </select>
              <label className="check">
                <input type="checkbox" checked={isAllDay(row)} disabled={row.is_closed} aria-label={`${DAY_NAMES[day]} open 24 hours`}
                  onChange={(e) => {
                    const open = hourOf(row.open_time)
                    // 24 hours: close at the opening time (from midnight, at midnight: 24:00, one of the close options).
                    // Unticked: a normal day closing at 10 PM (or midnight).
                    const closeAt = e.target.checked ? (open === 0 ? 24 : open) : open < 22 ? 22 : 24
                    update(day, { close_time: hourToTime(closeAt) })
                  }} />
                <span>24 hours</span>
              </label>
              {!row.is_closed && isOvernight(row) && !isAllDay(row) && (
                <span className="muted small">closes next day</span>
              )}
            </div>
          )
        })}
      </div>
      <p className="muted small">A closing time at or before the opening time means the venue closes the next morning.</p>
      {overlap && <p className="form-error" role="alert">{overlapMessage(overlap)}</p>}
      <div className="form-actions">
        <button type="submit" className="btn" disabled={saving || !!overlap}>{saving ? 'Saving…' : 'Save hours'}</button>
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

  const [courtId, setCourtId] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [reason, setReason] = useState('')

  const courtName = (id: string | null) =>
    id ? courts.data?.find((c) => c.id === id)?.name ?? 'Unknown court' : 'All courts'

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    create.mutate(
      {
        court_id: courtId || null,
        starts_at: zonedLocalToISO(startsAt, timeZone),
        ends_at: zonedLocalToISO(endsAt, timeZone),
        reason: reason.trim(),
      },
      {
        onSuccess: () => {
          setStartsAt('')
          setEndsAt('')
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
            <span>Starts</span>
            <input type="datetime-local" step={3600} required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </label>
          <label className="field">
            <span>Ends</span>
            <input type="datetime-local" step={3600} required min={startsAt || undefined} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </label>
          <label className="field">
            <span>Reason</span>
            <input value={reason} placeholder="e.g. Floor maintenance" onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn" disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add blackout'}</button>
          {create.error && <span className="form-error" role="alert">{errorMessage(create.error)}</span>}
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
