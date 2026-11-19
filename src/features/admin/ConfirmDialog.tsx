/** A modal with a safe default (the first button), Escape to cancel and Tab kept inside. */
export function ConfirmDialog({ id, title, body, stay, confirm, onStay, onConfirm, confirmDisabled = false, error = null }: {
  id: string; title: string; body: string; stay: string; confirm: string; onStay: () => void; onConfirm: () => void
  /** While the confirmed action runs (T29.7). */
  confirmDisabled?: boolean
  /** A failed confirmed action, shown inside the dialog, which stays open (T29.7). */
  error?: string | null
}) {
  return <div className="modal-backdrop" role="presentation">
    <section className="dialog card stack" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); onStay() }
      if (event.key !== 'Tab') return
      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button')
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && (event.target === first || !event.currentTarget.contains(event.target as Node))) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && event.target === last) {
        event.preventDefault()
        first?.focus()
      }
    }}>
      <h2 id={`${id}-title`}>{title}</h2>
      <p>{body}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn-outline" autoFocus onClick={onStay}>{stay}</button>
        <button type="button" className="btn" disabled={confirmDisabled} onClick={onConfirm}>{confirm}</button>
      </div>
    </section>
  </div>
}
