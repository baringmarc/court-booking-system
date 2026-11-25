import { useId } from 'react'
import { refundMessage, type PlayerRefund } from './refund'

/** The booking's refund on /booking/:ref (T30.6): owed, refunded (how and when) or not refunded (why). */
export function RefundNotice({ refund, timeZone, currency, title = 'Refund' }: {
  refund: PlayerRefund | null; timeZone: string; currency: string
  /** "Refund: <court>" for one court of a group (T33.4). */
  title?: string
}) {
  const headingId = useId()
  if (!refund) return null
  return (
    <section className="card" aria-labelledby={headingId}>
      <h2 id={headingId} className="card-head">{title}</h2>
      <p>{refundMessage(refund, { currency, timeZone })}</p>
    </section>
  )
}
