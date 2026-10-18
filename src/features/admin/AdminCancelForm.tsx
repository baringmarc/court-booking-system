import { useState, type FormEvent } from 'react'
import { bookingErrorMessage } from '../booking/errors'

type Props = {
  /** A payment was approved: cancelling doesn't refund it (SPEC §4). */
  paid: boolean
  pending: boolean
  error: unknown
  onCancel: (reason: string) => void
}

/** Staff cancel an active booking until it ends. The reason is required because the player sees it. */
export function AdminCancelForm({ paid, pending, error, onCancel }: Props) {
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!reason.trim()) {
      setReasonError('Give a reason so the player knows why.')
      return
    }
    setReasonError(null)
    onCancel(reason.trim())
  }

  return (
    <form className="card stack" onSubmit={handleSubmit} noValidate aria-label="Cancel booking">
      <h3>Cancel booking</h3>
      <p className="small muted">
        The times are released straight away and the player sees your reason.
        {paid && ' A payment was already approved: settle any refund outside the app.'}
      </p>
      {error != null && <div className="alert alert-error" role="alert"><p>{bookingErrorMessage(error)}</p></div>}
      <div className="field">
        <label htmlFor="cancel-reason">Reason for cancelling</label>
        <textarea id="cancel-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
          aria-invalid={reasonError ? true : undefined} aria-describedby={reasonError ? 'cancel-reason-error' : undefined} />
        {reasonError && <p id="cancel-reason-error" className="form-error">{reasonError}</p>}
      </div>
      <div>
        <button type="submit" className="btn btn-danger" disabled={pending}>{pending ? 'Cancelling…' : 'Cancel booking'}</button>
      </div>
    </form>
  )
}
