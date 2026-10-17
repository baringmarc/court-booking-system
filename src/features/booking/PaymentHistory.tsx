import { formatMoney } from '../../lib/format'
import { formatDateTimeInZone } from '../../lib/time'
import type { PaymentAttempt } from './api'
import { METHOD_LABELS } from './proofInput'

const REVIEW_LABELS = { pending: 'Under review', approved: 'Accepted', rejected: 'Not accepted' } as const

export function PaymentHistory({ payments, timeZone, currency }: { payments: PaymentAttempt[]; timeZone: string; currency: string }) {
  if (payments.length === 0) return null
  return (
    <section className="card" aria-labelledby="payments-heading">
      <h2 id="payments-heading">Payments</h2>
      <ul className="list">
        {payments.map((p) => (
          <li key={p.id} className="list-row">
            <div>
              <div>{METHOD_LABELS[p.method]} · {formatMoney(p.amount, currency)}</div>
              <div className="muted small">
                {formatDateTimeInZone(p.submitted_at, timeZone)}{p.reference_number ? ` · Ref ${p.reference_number}` : ''}
              </div>
              {p.review_status === 'rejected' && p.review_note && <div className="small">Reason: {p.review_note}</div>}
            </div>
            <span className={`badge review-${p.review_status}`}>{REVIEW_LABELS[p.review_status]}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
