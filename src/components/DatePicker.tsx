import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import { addDays, formatDateLabel } from '../lib/time'
import type { CalendarProps } from './Calendar'
import { PageLoader } from './PageLoader'
import { isDateAllowed } from './pickerHours'

const Calendar = lazy(() => import('./Calendar'))

type Props = {
  label: string
  /** "YYYY-MM-DD" in the venue's calendar. */
  value: string
  onChange: (date: string) => void
  /** The venue's today (operatingToday or todayInZone), never the browser's clock. */
  today: string
  min?: string
  max?: string
  /** Days of the week (0 = Sunday) that can't be picked, e.g. closed days. */
  closedDays?: number[]
  timeZone: string
}

/**
 * A date with "Today" and "Tomorrow" quick picks and a calendar in a dialog (T10.2). The calendar is a lazy chunk,
 * fetched the first time it opens.
 */
export function DatePicker({ label, value, onChange, today, min, max, closedDays, timeZone }: Props) {
  const [open, setOpen] = useState(false)
  const labelId = useId()
  const rules = { min, max, closedDays }
  const tomorrow = addDays(today, 1)
  const shown = formatDateLabel(value, timeZone)
  const quick = [
    { date: today, text: 'Today' },
    { date: tomorrow, text: 'Tomorrow' },
  ]

  return (
    <div className="date-picker" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="field-label">{label}</span>
      <div className="choice-options">
        {quick.map((q) => (
          <button key={q.text} type="button" className="btn btn-outline btn-small" aria-pressed={value === q.date}
            disabled={!isDateAllowed(q.date, rules)} onClick={() => onChange(q.date)}>
            {q.text}
          </button>
        ))}
        <button type="button" className="btn btn-outline btn-small" aria-haspopup="dialog"
          aria-label={`Choose a date, ${shown}`} onClick={() => setOpen(true)}>
          {shown}
        </button>
      </div>
      {open && (
        <CalendarDialog title={label} selected={value} today={today} min={min} max={max} closedDays={closedDays}
          onSelect={onChange} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}

type DialogProps = CalendarProps & { title: string; onClose: () => void }

/** A native modal <dialog>, like OpenPlayDialog: the browser traps focus, Escape closes, focus returns to the opener. */
function CalendarDialog({ title, onClose, onSelect, ...calendar }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  // Whatever had focus before the first render (the date button), so a StrictMode re-run can't swap it.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) {
      dialog.showModal()
      // Opening focuses the first button (previous month). Once the calendar chunk is cached, it has already focused
      // its day, so give that back; on a first load its autoFocus runs after this.
      dialog.querySelector<HTMLElement>('.rdp-day_button[tabindex="0"]')?.focus()
    }
    return () => opener?.focus()
  }, [opener])

  return (
    <dialog ref={ref} className="dialog calendar-dialog" aria-labelledby={titleId} onClose={onClose}>
      <div className="dialog-body stack">
        <h2 id={titleId}>{title}</h2>
        <Suspense fallback={<PageLoader />}>
          <Calendar {...calendar} onSelect={(date) => { onSelect(date); ref.current?.close() }} />
        </Suspense>
        <button type="button" className="btn btn-outline" onClick={() => ref.current?.close()}>Close</button>
      </div>
    </dialog>
  )
}
