import { formatHour, formatMoney } from '../../lib/format'
import { formatDateLabel, hourInZone } from '../../lib/time'
import type { RunSummary, SelectionSummary } from './selection'

type Props = {
  summary: SelectionSummary
  courtName: (courtId: string) => string
  date: string
  timeZone: string
  currency: string
  /** The booking fee; null while it loads or if it failed, so no total is guessed. One fee per checkout (T33.1). */
  fee: number | null
  onRemoveRun: (run: RunSummary) => void
  onClear: () => void
  onContinue: () => void
}

const hours = (n: number) => `${n} ${n === 1 ? 'hour' : 'hours'}`

export function SelectionBar({ summary, courtName, date, timeZone, currency, fee, onRemoveRun, onClear, onContinue }: Props) {
  const range = (run: RunSummary) => `${formatHour(hourInZone(run.start, timeZone))}–${formatHour(hourInZone(run.end, timeZone))}`
  const { runs } = summary
  const single = runs.length === 1 ? runs[0] : null
  const slots = runs.reduce((sum, r) => sum + r.slots, 0)
  return (
    <div className="selection-bar" role="region" aria-label="Your selection">
      <div className="selection-text">
        {single ? (
          <>
            <strong>{courtName(single.courtId)}</strong>
            <span className="muted small">{formatDateLabel(date, timeZone)} · {range(single)} · {hours(single.slots)}</span>
          </>
        ) : (
          <>
            <strong>{`${runs.length} times · ${summary.courtCount} ${summary.courtCount === 1 ? 'court' : 'courts'}`}</strong>
            <span className="muted small">{formatDateLabel(date, timeZone)} · {hours(slots)}</span>
            {/* Every run with its own Remove, so a phone can review and trim the checkout (T33.3). */}
            <ul className="selection-runs small" aria-label="Selected times">
              {runs.map((run) => {
                const label = `${courtName(run.courtId)}, ${range(run)}`
                return (
                  <li key={`${run.courtId}-${run.start}`}>
                    <span>{label}</span>
                    <button type="button" className="btn btn-small btn-ghost" aria-label={`Remove ${label}`} onClick={() => onRemoveRun(run)}>
                      Remove
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
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
