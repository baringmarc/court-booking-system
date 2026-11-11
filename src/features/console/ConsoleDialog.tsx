import type { ReactNode } from 'react'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'

/**
 * A console modal (T17.28): Escape cancels and Tab stays inside. The opener gets focus back from its caller
 * (`returnFocus`), since the panel that opened it can be re-rendered while the dialog is open. `tabIndex={-1}` keeps
 * focus in the dialog when its text is clicked, so Escape still cancels (T18.2).
 */
export function ConsoleDialog({ id, title, onCancel, children }: { id: string; title: string; onCancel: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="dialog card stack" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); onCancel() }
        if (event.key !== 'Tab') return
        const items = event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)
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
        <h2 id={`${id}-title`}>{title}</h2>
        {children}
      </section>
    </div>
  )
}

