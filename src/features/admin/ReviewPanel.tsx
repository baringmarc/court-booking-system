import { useState, type FormEvent } from 'react'
import { formatHour, formatMoney } from '../../lib/format'
import { formatDateLabel, formatDateTimeInZone, hourInZone, todayInZone } from '../../lib/time'
import { bookingErrorMessage } from '../booking/errors'
import { amountMismatch, paymentLabel } from '../booking/proofInput'
import { displayStatus, STATUS_LABELS } from '../booking/status'
import { hasApprovedPayment, pendingPayment, type AdminBooking } from './api'
import { onlinePayments, paymentFlags, sourceLabel } from './paymentFlags'

export type ProofLink = { state: 'none' } | { state: 'loading' } | { state: 'error' } | { state: 'ready'; url: string }

type Props = {
  booking: AdminBooking
  timeZone: string
  currency: string
  proof: ProofLink
  pending: boolean
  error: unknown
  onApprove: () => void
  onReject: (note: string) => void
  now?: Date
}

export function ReviewPanel({ booking, timeZone, currency, proof, pending, error, onApprove, onReject, now }: Props) {
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  const payment = pendingPayment(booking)
  const canReview = booking.status === 'payment_submitted' && payment !== null
  const status = displayStatus(booking, now)
  const date = todayInZone(timeZone, new Date(booking.slot_start))
  const online = onlinePayments(booking)
  const flags = paymentFlags(booking)

  function handleReject(e: FormEvent) {
    e.preventDefault()
    if (!note.trim()) {
      setNoteError('Give a reason so the player knows what to fix.')
      return
    }
    setNoteError(null)
    onReject(note.trim())
  }

  return (
    <section className="card stack" aria-label={`Booking ${booking.reference_code}`}>
      <div className="page-head">
        <h2>{booking.reference_code}</h2>
        <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>
      </div>
      <dl className="facts">
        <div><dt>Court</dt><dd>{booking.court_name}</dd></div>
        <div>
          <dt>When</dt>
          <dd>{formatDateLabel(date, timeZone)}, {formatHour(hourInZone(booking.slot_start, timeZone))}–{formatHour(hourInZone(booking.slot_end, timeZone))}</dd>
        </div>
        <div><dt>Court price</dt><dd>{formatMoney(booking.total_amount, currency)}</dd></div>
        {booking.booking_fee > 0 && <div><dt>Booking fee</dt><dd>{formatMoney(booking.booking_fee, currency)}</dd></div>}
        <div><dt>Total</dt><dd>{formatMoney(booking.amount_due, currency)}</dd></div>
        <div><dt>Customer</dt><dd>{booking.guest_name}</dd></div>
        {booking.guest_phone && <div><dt>Phone</dt><dd><a href={`tel:${booking.guest_phone}`}>{booking.guest_phone}</a></dd></div>}
        {booking.guest_email && <div><dt>Email</dt><dd>{booking.guest_email}</dd></div>}
        {booking.rejection_count > 0 && <div><dt>Rejections</dt><dd>{booking.rejection_count}</dd></div>}
      </dl>

      {booking.status === 'cancelled' && (
        <div className="stack">
          <p className="small">
            Cancelled {booking.cancelled_by_venue ? 'by staff' : 'by the customer'}
            {booking.cancelled_at ? ` on ${formatDateTimeInZone(booking.cancelled_at, timeZone)}` : ''}
            {booking.cancel_reason ? `: ${booking.cancel_reason}` : '.'}
          </p>
          {hasApprovedPayment(booking) && (
            <p className="form-warning" role="status">Cancelled after payment: settle any refund outside the app.</p>
          )}
        </div>
      )}

      {online.length > 0 && (
        // Paid on PayMongo and recorded by its webhook: nothing to review here (SPEC §4).
        <div className="stack">
          <h3>Online payments</h3>
          <ul className="list">
            {online.map((p) => (
              <li key={p.id} className="list-row">
                <span className="small">
                  {paymentLabel(p)}{sourceLabel(p.provider_source) ? ` · ${sourceLabel(p.provider_source)}` : ''} · {formatMoney(p.amount, currency)}
                  <span className="muted block">
                    {p.provider_payment_id} · paid {formatDateTimeInZone(p.reviewed_at ?? p.submitted_at, timeZone)}
                  </span>
                </span>
                <span className={`badge review-${p.review_status}`}>{p.review_status === 'approved' ? 'Accepted' : 'Refund due'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {flags.refundDue.map((p) => (
        <p key={p.id} className="form-warning" role="status">
          Paid online ({formatMoney(p.amount, currency)}) but not accepted{p.review_note ? `: ${p.review_note}` : '.'} Refund it outside the app.
        </p>
      ))}
      {flags.supersededProofs.length > 0 && (
        <p className="form-warning" role="status">
          The customer paid online after uploading a proof, so the proof was closed automatically. Check it for a duplicate
          payment and refund outside the app if needed.
        </p>
      )}

      {payment ? (
        <div className="stack">
          <h3>Proof waiting for review</h3>
          <p className="small">
            {paymentLabel(payment)} · {formatMoney(payment.amount, currency)}
            {payment.reference_number ? ` · Ref ${payment.reference_number}` : ''} · {formatDateTimeInZone(payment.submitted_at, timeZone)}
          </p>
          {amountMismatch(String(payment.amount), booking.amount_due) && (
            <p className="form-warning" role="status">
              Paid {formatMoney(payment.amount, currency)} but the total is {formatMoney(booking.amount_due, currency)}.
            </p>
          )}
          <ProofPreview path={payment.storage_path} proof={proof} />
        </div>
      ) : (
        <p className="muted small">No proof is waiting for review.</p>
      )}

      {error != null && <div className="alert alert-error" role="alert"><p>{bookingErrorMessage(error)}</p></div>}

      {canReview && (
        <div className="stack">
          <button type="button" className="btn" disabled={pending} onClick={onApprove}>Approve and confirm</button>
          <form className="stack" onSubmit={handleReject} noValidate>
            <div className="field">
              <label htmlFor="reject-note">Reason for rejecting</label>
              <textarea id="reject-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
                aria-invalid={noteError ? true : undefined} aria-describedby={noteError ? 'reject-note-error' : undefined} />
              {noteError && <p id="reject-note-error" className="form-error">{noteError}</p>}
            </div>
            <button type="submit" className="btn btn-outline" disabled={pending}>Reject proof</button>
          </form>
        </div>
      )}
    </section>
  )
}

function ProofPreview({ path, proof }: { path: string | null; proof: ProofLink }) {
  if (!path) return <p className="muted small">No file attached (recorded without a proof).</p>
  if (proof.state === 'loading' || proof.state === 'none') return <p className="muted small">Loading proof…</p>
  if (proof.state === 'error') return <p className="form-error">The proof file could not be loaded.</p>
  return path.toLowerCase().endsWith('.pdf') ? (
    <div className="stack">
      <object className="proof-frame" data={proof.url} type="application/pdf" aria-label="Proof of payment (PDF)" />
      <a href={proof.url} target="_blank" rel="noreferrer">Open PDF in a new tab</a>
    </div>
  ) : (
    <a href={proof.url} target="_blank" rel="noreferrer">
      <img className="proof-preview" src={proof.url} alt="Proof of payment" />
    </a>
  )
}
