import { bookingErrorMessage } from './errors'
import type { ReturnState } from './paymongoReturn'

type Props = { pending: boolean; error: unknown; onPay: () => void }

/** "Pay online with PayMongo" next to the manual proof upload (the page owns the mutation and the redirect). */
export function PayOnline({ pending, error, onPay }: Props) {
  return (
    <div className="stack pay-online">
      <button type="button" className="btn btn-block" disabled={pending} onClick={onPay}>
        {pending ? 'Opening PayMongo…' : 'Pay online with PayMongo'}
      </button>
      <p className="muted small">GCash, Maya, card or QR Ph. You'll come back here after paying, and we confirm it automatically.</p>
      {error != null && (
        <div className="alert alert-error" role="alert"><p>{bookingErrorMessage(error)}</p></div>
      )}
    </div>
  )
}

/** What happened after the player came back from PayMongo. */
export function PaymongoReturnNotice({ state }: { state: ReturnState }) {
  switch (state) {
    case 'confirming':
      return (
        <div className="alert alert-info" role="status">
          <p>Confirming your payment… This usually takes a few seconds.</p>
        </div>
      )
    case 'confirmed':
      return (
        <div className="alert alert-info" role="status">
          <p>Payment received. Your booking is confirmed.</p>
        </div>
      )
    case 'not_accepted':
      return (
        <div className="alert alert-error" role="status">
          <p>We received your online payment but couldn't apply it to this booking. The venue will arrange a refund; see Payments below.</p>
        </div>
      )
    case 'timeout':
      return (
        <div className="alert alert-info" role="status">
          <p>We haven't heard back from PayMongo yet. If you paid, this page keeps checking and updates once it arrives.</p>
        </div>
      )
    case 'cancelled':
      return (
        <div className="alert alert-info" role="status">
          <p>Online payment was cancelled. You can try again, or pay manually and upload a proof.</p>
        </div>
      )
    default:
      return null
  }
}
