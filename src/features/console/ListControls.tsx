import { useEffect, useRef, useState, type ReactNode } from 'react'
import { detailsButtonId } from './listParams'

/** How long typing pauses before a search is applied. */
const SEARCH_DELAY_MS = 300

/**
 * A search box over a URL-held term. Typing is applied after a short pause; when the URL term changes from elsewhere
 * (Back, a link), the box shows the new term.
 */
export function SearchField({ id, label, value, onSearch }: { id: string; label: string; value: string; onSearch: (term: string) => void }) {
  const [draft, setDraft] = useState({ from: value, text: value })
  let text = draft.text
  if (draft.from !== value) {
    // The URL moved on (Back, or this box's own search landing): show what the URL says now.
    setDraft({ from: value, text: value })
    text = value
  }
  const search = useRef(onSearch)
  useEffect(() => { search.current = onSearch })
  useEffect(() => {
    if (text === value) return
    const timer = window.setTimeout(() => search.current(text), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [text, value])
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="search" autoComplete="off" value={text} onChange={(e) => setDraft({ from: value, text: e.target.value })} />
    </div>
  )
}

export function StatusFilter({ id, value, options, onChange }: {
  id: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void
}) {
  return (
    <div className="field">
      <label htmlFor={id}>Filter by status</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </div>
  )
}

/** One record's details and actions beside (desktop) or below (phone) its list. Focus moves to it when it opens. */
export function RecordPanel({ label, title, onClose, children }: { label: string; title: ReactNode; onClose: () => void; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus({ preventScroll: false }) }, [label])
  return (
    <section className="card stack console-panel" aria-label={label}>
      <div className="page-head">
        <h2 ref={heading} tabIndex={-1}>{title}</h2>
        <button type="button" className="btn btn-outline btn-small" onClick={onClose}>Close</button>
      </div>
      {children}
    </section>
  )
}

/** How a status reads at a glance: good (live, paid, approved), warn (needs attention), bad (stopped) or neutral. */
export type StatusTone = 'good' | 'warn' | 'bad' | 'neutral' | 'info'

const STATUS_TONES: Record<string, StatusTone> = {
  active: 'good', won: 'good', paid: 'good', approved: 'good',
  draft: 'warn', talking: 'warn', sent: 'warn',
  suspended: 'bad',
  new: 'info',
  closed: 'neutral', lost: 'neutral', hidden: 'neutral',
}

/** A status pill colored by its tone (T25.1); the text is the status as before. */
export function StatusBadge({ status, children }: { status: string; children?: ReactNode }) {
  return <span className={`badge tone-${STATUS_TONES[status.toLowerCase()] ?? 'neutral'}`}>{children ?? status}</span>
}

/** A titled group inside a record panel (T25.1). `danger` sets the destructive actions apart. */
export function PanelSection({ title, danger = false, children }: { title: string; danger?: boolean; children: ReactNode }) {
  return (
    <section className={`panel-section${danger ? ' panel-section-danger' : ''}`}>
      <h3 className="panel-section-title">{title}</h3>
      {children}
    </section>
  )
}

/** The Details button of a compact row; its id lets a closing panel hand focus back. */
export function DetailsButton({ id, name, onOpen }: { id: string; name: string; onOpen: () => void }) {
  return <button type="button" id={detailsButtonId(id)} className="btn btn-ghost btn-small" aria-label={`Details for ${name}`} onClick={onOpen}>Details</button>
}

/** Loading, error and empty states shared by the four list pages. */
export function ListStatus({ noun, pending, error, onRetry, empty, filtered }: {
  noun: string; pending: boolean; error: unknown; onRetry: () => void; empty: boolean; filtered: string
}): ReactNode {
  if (pending) return <p className="muted">Loading {noun}…</p>
  if (error) {
    return (
      <div className="alert alert-error">
        <p>Couldn't load {noun}.</p>
        <button type="button" className="btn btn-ghost" onClick={onRetry}>Retry</button>
      </div>
    )
  }
  if (empty) return <p className="muted">{filtered}</p>
  return null
}
