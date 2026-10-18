import { formatMoney } from '../../lib/format'
import { METHOD_LABELS } from '../booking/proofInput'
import type { refundsDueSummary, takingsByMethod } from './dashboard'

type Props = {
  takings: ReturnType<typeof takingsByMethod>
  refundsDue: ReturnType<typeof refundsDueSummary> | null
  currency: string
  /** The refunds-due query failed: say so (staff may owe a refund), with a retry. */
  refundsError?: boolean
  onRetryRefunds?: () => void
}

/** Today's takings by method (PayMongo included), with online money that wasn't accepted shown apart from the total. */
export function TakingsCard({ takings, refundsDue, currency, refundsError = false, onRetryRefunds }: Props) {
  return (
    <>
      {takings.rows.length > 0 ? (
        <>
          <p className="big-number">{formatMoney(takings.total, currency)}</p>
          <ul className="list" aria-label="Takings by method">
            {takings.rows.map((r) => (
              <li key={r.method} className="list-row"><span>{METHOD_LABELS[r.method]}</span><span>{formatMoney(r.total, currency)}</span></li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">Nothing taken yet today.</p>
      )}
      {refundsError && (
        <p className="form-error small" role="alert">
          Couldn't check for online payments to refund.{' '}
          {onRetryRefunds && <button type="button" className="btn btn-small btn-outline" onClick={onRetryRefunds}>Try again</button>}
        </p>
      )}
      {refundsDue && refundsDue.count > 0 && (
        <p className="form-warning" role="status">
          Also received online but not accepted: {formatMoney(refundsDue.total, currency)} ({refundsDue.count}{' '}
          {refundsDue.count === 1 ? 'payment' : 'payments'}). Not in the total; refund outside the app.
        </p>
      )}
    </>
  )
}
