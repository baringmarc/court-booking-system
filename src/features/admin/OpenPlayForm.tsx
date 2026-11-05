import { useState, type FormEvent } from 'react'
import { DatePicker } from '../../components/DatePicker'
import { DurationPicker, HourPicker } from '../../components/HourPicker'
import { endAfter, findHour, hoursBetween, maxDuration } from '../../components/pickerHours'
import { useStaffSchedule } from '../catalog/hooks'
import { formatHour } from '../../lib/format'
import { addDays, todayInZone } from '../../lib/time'
import { useStaffOperatingDate } from './staffDate'
import { PageLoader } from '../../components/PageLoader'
import { ErrorMessage } from '../../components/ErrorMessage'
import { errorMessage } from '../../lib/errors'
import { SPORT_LABELS, type Court, type OperatingHours } from '../catalog/api'
import type { OpenPlayInput, OpenPlaySession } from '../openPlay/api'
import { DETAILS_MAX, LABEL_MAX, linksFromRows, MAX_LINKS, TITLE_MAX, type OpenPlayLink } from '../openPlay/session'

type Props = {
  /** The session being edited, or null for a new one. Remount with `key` to reset. */
  initial: OpenPlaySession | null
  /** Active courts, plus any archived ones the session already uses (shown as archived, so they can be unticked). */
  courts: Pick<Court, 'id' | 'name' | 'sport' | 'is_active'>[]
  /** The venue's opening hours: a session fits within one operating day. */
  hours: OperatingHours[]
  timeZone: string
  /** Hours that have started can't be picked. */
  now: Date
  saving: boolean
  /** The last save's error: the server's message (a clash names the courts). */
  error: unknown
  onSave: (input: OpenPlayInput) => void
  onCancel?: () => void
}

const emptyRows = (links: OpenPlayLink[]) =>
  Array.from({ length: MAX_LINKS }, (_, i) => links[i] ?? { label: '', url: '' })

/**
 * Create or edit one open play session (T9.11d). The time is a date, a start hour and a length within that operating
 * day (T10.3). The RPCs check every rule; this catches the obvious slips.
 */
export function OpenPlayForm({ initial, courts, timeZone, now, saving, error, onSave, onCancel }: Props) {
  const [courtIds, setCourtIds] = useState<string[]>(initial?.court_ids ?? [])
  const today = useStaffOperatingDate(timeZone, now, courtIds)
  const initialDate = initial ? todayInZone(timeZone, new Date(initial.starts_at)) : today
  const initialPrevious = useStaffSchedule(addDays(initialDate, -1))
  const initialOperatingDate = initial && initialPrevious.data?.some((p) => initial.court_ids.includes(p.court_id) && Date.parse(p.period_start) <= Date.parse(initial.starts_at) && Date.parse(initial.starts_at) < Date.parse(p.period_end)) ? addDays(initialDate, -1) : initialDate
  const [dateOverride, setDateOverride] = useState<string | null>(null)
  const date = dateOverride ?? initialOperatingDate
  const [start, setStart] = useState<string | null>(initial?.starts_at ?? null)
  const [duration, setDuration] = useState<number | null>(initial ? hoursBetween(initial.starts_at, initial.ends_at) : null)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [details, setDetails] = useState(initial?.details ?? '')
  const [rows, setRows] = useState(() => emptyRows(initial?.links ?? []))
  const [problem, setProblem] = useState<string | null>(null)

  // Derived, not synced: a start that isn't on the chosen day (or has started) and a length that no longer fits drop out.
  const schedule = useStaffSchedule(date)
  const periods = schedule.data ?? []
  const firstCourtPeriods = periods.filter((p) => p.court_id === courtIds[0])
  const options = firstCourtPeriods.flatMap((period) => {
    const result: { start: string; label: string; nextDay: boolean; periodEnd: string }[] = []
    for (let t = Date.parse(period.period_start); t < Date.parse(period.period_end); t += 3_600_000) {
      if (t <= now.getTime() || !courtIds.every((id) => periods.some((p) => p.court_id === id && Date.parse(p.period_start) <= t && t + 3_600_000 <= Date.parse(p.period_end)))) continue
      const start = new Date(t).toISOString()
      const end = Math.min(...courtIds.map((id) => Date.parse(periods.find((p) => p.court_id === id && Date.parse(p.period_start) <= t && t + 3_600_000 <= Date.parse(p.period_end))!.period_end)))
      result.push({ start, label: formatHour(Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(t))), nextDay: todayInZone(timeZone, new Date(t)) !== date, periodEnd: new Date(end).toISOString() })
    }
    return result
  })
  const unchangedCourts = !!initial && courtIds.length === initial.court_ids.length && courtIds.every((id) => initial.court_ids.includes(id))
  const preserveExisting = !!initial && unchangedCourts && start === initial.starts_at && duration === hoursBetween(initial.starts_at, initial.ends_at)
  const chosenStart = findHour(options, start)?.start ?? (preserveExisting ? start : null)
  const selectedOption = options.find((o) => o.start === chosenStart)
  const max = selectedOption ? Math.min(maxDuration(options, chosenStart), (Date.parse(selectedOption.periodEnd) - Date.parse(selectedOption.start)) / 3_600_000) : 0
  const chosenHours = duration !== null && (duration <= max || preserveExisting) ? duration : null

  function toggleCourt(id: string, on: boolean) {
    setCourtIds((ids) => (on ? [...ids, id] : ids.filter((c) => c !== id)))
  }

  function setRow(i: number, patch: Partial<OpenPlayLink>) {
    setRows((current) => current.map((row, j) => (j === i ? { ...row, ...patch } : row)))
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const { links, error: linkError } = linksFromRows(rows)
    const next = courtIds.length === 0 ? 'Choose at least one court.'
      : !chosenStart ? 'Choose a start time.'
      : !chosenHours ? 'Choose how long the session runs.'
      : linkError
    setProblem(next)
    if (next || !chosenStart || !chosenHours) return
    onSave({
      courtIds,
      start: chosenStart,
      end: endAfter(chosenStart, chosenHours),
      title: title.trim(),
      details: details.trim(),
      links,
    })
  }

  const message = problem ?? (error ? errorMessage(error) : null)

  return (
    <form className="stack" aria-label="Open play session" onSubmit={handleSubmit}>
      <fieldset className="field">
        <legend>Courts</legend>
        <div className="check-list">
          {courts.map((c) => (
            <label key={c.id} className="check">
              <input type="checkbox" checked={courtIds.includes(c.id)} onChange={(e) => toggleCourt(c.id, e.target.checked)} />
              {c.name} <span className="muted small">{SPORT_LABELS[c.sport]}{c.is_active ? '' : ' (archived)'}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <DatePicker label="Date" value={date} onChange={setDateOverride} today={today}
        min={today} timeZone={timeZone} />
      {schedule.isPending && <PageLoader />}
      {schedule.isError && <ErrorMessage error={schedule.error} onRetry={() => schedule.refetch()} />}
      {preserveExisting && !selectedOption && <p className="muted small">The existing session is outside current hours. You can keep its time while editing its details.</p>}
      <HourPicker label="Starts" options={options} value={chosenStart} onChange={setStart}
        empty="No start times left on this day." />
      <DurationPicker max={max} value={chosenHours} onChange={setDuration} />
      <label className="field">
        <span>Title</span>
        <input required maxLength={TITLE_MAX} value={title} placeholder="e.g. Saturday open play" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>Details <span className="muted small">(optional: skill level, fee, what to bring)</span></span>
        <textarea rows={4} maxLength={DETAILS_MAX} value={details} onChange={(e) => setDetails(e.target.value)} />
      </label>
      <fieldset className="field stack">
        <legend>Links <span className="muted small">(optional, https only: an RSVP form, Reclub…)</span></legend>
        {rows.map((row, i) => (
          <div key={i} className="form-grid">
            <label className="field">
              <span>Link {i + 1} label</span>
              <input maxLength={LABEL_MAX} value={row.label} onChange={(e) => setRow(i, { label: e.target.value })} />
            </label>
            <label className="field">
              <span>Link {i + 1} address</span>
              <input type="url" inputMode="url" placeholder="https://" value={row.url} onChange={(e) => setRow(i, { url: e.target.value })} />
            </label>
          </div>
        ))}
      </fieldset>
      <p className="muted small">Times are in {timeZone}. Players see these details on the booking page and can't book those slots.</p>
      <div className="form-actions">
        <button type="submit" className="btn" disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Add session'}
        </button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
        {message && <span className="form-error" role="alert">{message}</span>}
      </div>
    </form>
  )
}
