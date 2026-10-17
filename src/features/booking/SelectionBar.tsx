import { formatHour, formatMoney } from '../../lib/format'
import { formatDateLabel, hourInZone } from '../../lib/time'
import type { SelectionSummary } from './selection'

type Props = {
  summary: SelectionSummary
  courtName: string
  date: string
  timeZone: string
  currency: string
  onClear: () => void
  onContinue: () => void
}

export function SelectionBar({ summary, courtName, date, timeZone, currency, onClear, onContinue }: Props) {
  const from = formatHour(hourInZone(summary.start, timeZone))
  const to = formatHour(hourInZone(summary.end, timeZone))
  return (
    <div className="selection-bar" role="region" aria-label="Your selection">
      <div className="selection-text">
        <strong>{courtName}</strong>
        <span className="muted small">
          {formatDateLabel(date, timeZone)} · {from}–{to} · {summary.slots} {summary.slots === 1 ? 'hour' : 'hours'}
        </span>
      </div>
      <strong className="selection-total">{formatMoney(summary.total, currency)}</strong>
      <div className="selection-actions">
        <button type="button" className="btn btn-small btn-ghost" onClick={onClear}>Clear</button>
        <button type="button" className="btn btn-small" onClick={onContinue}>Continue</button>
      </div>
    </div>
  )
}
