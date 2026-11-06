import type { ReactNode } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The Review changes dialog (T17.31): every pending change in plain words, then what it affects. Escape and Keep editing close it; Tab stays inside. */
export function ReviewDialog({ lines, children, onKeep, onSave }: {
  lines: string[]
  children?: ReactNode
  onKeep: () => void
  onSave: () => void
}) {
  return <div className="modal-backdrop" role="presentation">
    <section className="dialog card stack review-dialog" role="dialog" aria-modal="true" aria-labelledby="review-changes-title" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); onKeep() }
      if (event.key !== 'Tab') return
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && (event.target === first || !event.currentTarget.contains(event.target as Node))) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && event.target === last) {
        event.preventDefault()
        first?.focus()
      }
    }}>
      <h2 id="review-changes-title">Review changes</h2>
      <ul className="list review-lines">{lines.map((line) => <li key={line}>{line}</li>)}</ul>
      {children}
      <div className="form-actions">
        <button type="button" className="btn btn-outline" autoFocus onClick={onKeep}>Keep editing</button>
        <button type="button" className="btn" onClick={onSave}>Save changes</button>
      </div>
    </section>
  </div>
}
