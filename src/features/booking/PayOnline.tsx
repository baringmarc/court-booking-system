import { bookingErrorMessage } from './errors'
import type { ReturnState } from './paymongoReturn'

/** idle; opening: creating the checkout; redirecting: the browser is leaving for PayMongo (can be slow). */
export type PayOnlineState = 'idle' | 'opening' | 'redirecting'

type Props = { state: PayOnlineState; error: unknown; onPay: () => void }

const BUSY_TEXT = { opening: 'Opening PayMongo…', redirecting: 'Taking you to PayMongo…' } as const

/** "Pay online with PayMongo" next to the manual proof upload (the page owns the mutation and the redirect). */
export function PayOnline({ state, error, onPay }: Props) {
  const busy = state !== 'idle'
  return (
    <div className="stack pay-online">
      {/* aria-busy on the button only: a busy ancestor could hold back the live line below. */}
      <button type="button" className="btn btn-block" disabled={busy} aria-busy={busy} onClick={onPay}>
        {busy && <span className="spinner spinner-inline" aria-hidden="true" />}
        {busy ? BUSY_TEXT[state] : 'Pay online with PayMongo'}
      </button>
      {/* One live line: screen readers hear the change when the checkout starts (T9.11f). */}
      <p className="muted small" role="status">
        {busy
          ? `${BUSY_TEXT[state]} This can take a few seconds; please keep this page open.`
          : "GCash, Maya, card or QR Ph. You'll come back here after paying, and we confirm it automatically."}
      </p>
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
        <div className="alert alert-info alert-busy" role="status">
          <span className="spinner spinner-inline" aria-hidden="true" />
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
