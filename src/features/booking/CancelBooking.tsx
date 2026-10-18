import { useState, type FormEvent } from 'react'
import { formatDateTimeInZone } from '../../lib/time'
import type { PlayerCancel } from './cancellation'
import { bookingErrorMessage } from './errors'

type Props = {
  check: PlayerCancel
  timeZone: string
  /** A payment was already approved: refunds happen outside the app (SPEC §4). */
  paid: boolean
  pending: boolean
  error: unknown
  onCancel: (reason: string) => void
}

/** Cancel button with a confirmation step for guests and owners, or the "too late" note after the cutoff. */
export function CancelBooking({ check, timeZone, paid, pending, error, onCancel }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')

  if (check.kind === 'not_active') return null
  const deadline = formatDateTimeInZone(check.deadline.toISOString(), timeZone)

  if (check.kind === 'closed') {
    return (
      <p className="muted small">
        Online cancellation closed at {deadline}. Contact the venue if you can't make it.
      </p>
    )
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onCancel(reason)
  }

  return (
    <section className="card stack" aria-labelledby="cancel-heading">
      <h2 id="cancel-heading">Need to cancel?</h2>
      <p className="small muted">You can cancel online until {deadline}.</p>
      {error != null && <div className="alert alert-error" role="alert"><p>{bookingErrorMessage(error)}</p></div>}
      {confirming ? (
        <form className="stack" onSubmit={handleSubmit}>
          <p className="small">
            Cancel this booking? The times will be released for others to book.
            {paid && ' Payments are not refunded online: contact the venue about a refund.'}
          </p>
          <div className="field">
            <label htmlFor="cancel-reason">Reason (optional)</label>
            <textarea id="cancel-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-danger" disabled={pending}>
              {pending ? 'Cancelling…' : 'Yes, cancel booking'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setConfirming(false)}>
              Keep booking
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button type="button" className="btn btn-outline" onClick={() => setConfirming(true)}>Cancel booking</button>
        </div>
      )}
    </section>
  )
}
