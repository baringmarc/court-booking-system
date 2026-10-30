import { formatMoney } from '../../lib/format'
import { formatDateTimeInZone } from '../../lib/time'
import type { PaymentAttempt } from './api'
import { isReplacedByOnlinePayment } from './paymentLabels'
import { paymentLabel } from './proofInput'

const REVIEW_LABELS = { pending: 'Under review', approved: 'Accepted', rejected: 'Not accepted' } as const
// PayMongo payments are never reviewed: they're paid online, or received too late and refunded (SPEC §4).
const ONLINE_LABELS = { pending: 'Processing', approved: 'Paid online', rejected: 'Refund due' } as const

export function PaymentHistory({ payments, timeZone, currency }: { payments: PaymentAttempt[]; timeZone: string; currency: string }) {
  if (payments.length === 0) return null
  return (
    <section className="card" aria-labelledby="payments-heading">
      <h2 id="payments-heading" className="card-head">Payments</h2>
      <ul className="list">
        {payments.map((p) => {
          const replaced = isReplacedByOnlinePayment(p, payments)
          return (
          <li key={p.id} className="list-row">
            <div>
              <div>{paymentLabel(p)} · {formatMoney(p.amount, currency)}</div>
              <div className="muted small">
                {formatDateTimeInZone(p.submitted_at, timeZone)}{p.reference_number ? ` · Ref ${p.reference_number}` : ''}
              </div>
              {replaced && <div className="small">You paid online instead, so this proof wasn't needed.</div>}
              {!replaced && p.review_status === 'rejected' && p.review_note && (
                <div className="small">{p.method === 'paymongo' ? p.review_note : `Reason: ${p.review_note}`}</div>
              )}
            </div>
            {replaced ? (
              <span className="badge">Replaced by online payment</span>
            ) : (
              <span className={`badge review-${p.review_status}`}>
                {(p.method === 'paymongo' ? ONLINE_LABELS : REVIEW_LABELS)[p.review_status]}
              </span>
            )}
          </li>
          )
        })}
      </ul>
    </section>
  )
}
