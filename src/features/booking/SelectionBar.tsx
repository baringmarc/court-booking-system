import { formatHour, formatMoney } from '../../lib/format'
import { formatDateLabel, hourInZone } from '../../lib/time'
import type { SelectionSummary } from './selection'

type Props = {
  summary: SelectionSummary
  courtName: string
  date: string
  timeZone: string
  currency: string
  /** The booking fee; null while it loads or if it failed, so no total is guessed. */
  fee: number | null
  onClear: () => void
  onContinue: () => void
}

export function SelectionBar({ summary, courtName, date, timeZone, currency, fee, onClear, onContinue }: Props) {
  const from = formatHour(hourInZone(summary.start, timeZone))
  const to = formatHour(hourInZone(summary.end, timeZone))
  return (
    <div className="selection-bar" role="region" aria-label="Your selection">
      <div className="selection-text">
        <strong>{courtName}</strong>
        <span className="muted small">
          {formatDateLabel(date, timeZone)} · {from}–{to} · {summary.slots} {summary.slots === 1 ? 'hour' : 'hours'}
        </span>
        {summary.promoLabels.length > 0 && <span className="selection-promo small">{`Promo: ${summary.promoLabels.join(', ')}`}</span>}
        {fee !== null && fee > 0 && (
          <span className="muted small">
            {`Court ${formatMoney(summary.total, currency)} + booking fee ${formatMoney(fee, currency)} = ${formatMoney(summary.total + fee, currency)}`}
          </span>
        )}
      </div>
      <div className="selection-total">
        <strong>{formatMoney(summary.total + (fee ?? 0), currency)}</strong>
        {fee === null && <span className="muted small"> + booking fee</span>}
      </div>
      <div className="selection-actions">
        <button type="button" className="btn btn-small btn-ghost" onClick={onClear}>Clear</button>
        <button type="button" className="btn btn-small" onClick={onContinue}>Continue</button>
      </div>
    </div>
  )
}
