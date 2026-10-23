import { useState, type FormEvent } from 'react'
import { errorMessage } from '../../lib/errors'
import { isoToZonedLocal, zonedLocalToISO } from '../../lib/time'
import { SPORT_LABELS, type Court } from '../catalog/api'
import type { OpenPlayInput, OpenPlaySession } from '../openPlay/api'
import { DETAILS_MAX, LABEL_MAX, linksFromRows, MAX_LINKS, TITLE_MAX, type OpenPlayLink } from '../openPlay/session'

type Props = {
  /** The session being edited, or null for a new one. Remount with `key` to reset. */
  initial: OpenPlaySession | null
  /** Active courts, plus any archived ones the session already uses (shown as archived, so they can be unticked). */
  courts: Pick<Court, 'id' | 'name' | 'sport' | 'is_active'>[]
  timeZone: string
  saving: boolean
  /** The last save's error: the server's message (a clash names the courts). */
  error: unknown
  onSave: (input: OpenPlayInput) => void
  onCancel?: () => void
}

const emptyRows = (links: OpenPlayLink[]) =>
  Array.from({ length: MAX_LINKS }, (_, i) => links[i] ?? { label: '', url: '' })

/** Create or edit one open play session (T9.11d). The RPCs check every rule; this catches the obvious slips. */
export function OpenPlayForm({ initial, courts, timeZone, saving, error, onSave, onCancel }: Props) {
  const [courtIds, setCourtIds] = useState<string[]>(initial?.court_ids ?? [])
  const [startsAt, setStartsAt] = useState(initial ? isoToZonedLocal(initial.starts_at, timeZone) : '')
  const [endsAt, setEndsAt] = useState(initial ? isoToZonedLocal(initial.ends_at, timeZone) : '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [details, setDetails] = useState(initial?.details ?? '')
  const [rows, setRows] = useState(() => emptyRows(initial?.links ?? []))
  const [problem, setProblem] = useState<string | null>(null)

  function toggleCourt(id: string, on: boolean) {
    setCourtIds((ids) => (on ? [...ids, id] : ids.filter((c) => c !== id)))
  }

  function setRow(i: number, patch: Partial<OpenPlayLink>) {
    setRows((current) => current.map((row, j) => (j === i ? { ...row, ...patch } : row)))
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const { links, error: linkError } = linksFromRows(rows)
    const next = courtIds.length === 0
      ? 'Choose at least one court.'
      : endsAt <= startsAt ? 'The session must end after it starts.' : linkError
    setProblem(next)
    if (next) return
    onSave({
      courtIds,
      start: zonedLocalToISO(startsAt, timeZone),
      end: zonedLocalToISO(endsAt, timeZone),
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
      <div className="form-grid">
        <label className="field">
          <span>Starts</span>
          <input type="datetime-local" step={3600} required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label className="field">
          <span>Ends</span>
          <input type="datetime-local" step={3600} required min={startsAt || undefined} value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)} />
        </label>
      </div>
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
