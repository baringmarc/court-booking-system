// One panel for a multi-court checkout on /admin/bookings (M33, T33.6; SPEC §7 "Bookings in a group"): staff handle the
// checkout as one thing (the customer, the total, the payments and one review), while each court keeps its own booking,
// whose own actions (refund, reschedule, cancel) open in place under Manage.
import { useState, type FormEvent, type ReactNode } from 'react'
import { formatHour, formatMoney } from '../../lib/format'
import { formatDateLabel, formatDateTimeInZone, hourInZone, todayInZone } from '../../lib/time'
import { bookingErrorMessage } from '../booking/errors'
import { groupDisplayStatus } from '../booking/group'
import { amountMismatch, paymentLabel } from '../booking/proofInput'
import { displayStatus, STATUS_LABELS } from '../booking/status'
import type { AdminBooking, AdminGroup } from './api'
import { checkoutOnlinePayments, groupPayment } from './groups'
import { paymentFlags, sourceLabel } from './paymentFlags'
import { ProofPreview, type ProofLink } from './ReviewPanel'

type Props = {
  group: AdminGroup
  /** The court whose own actions are open (one at a time), or none. */
  openId: string | null
  onOpen: (id: string | null) => void
  timeZone: string
  currency: string
  proof: ProofLink
  pending: boolean
  error: unknown
  onApprove: () => void
  onReject: (note: string) => void
  now?: Date
  /** A court's own actions: its refund card, reschedule and cancel form. */
  renderCourt: (booking: AdminBooking) => ReactNode
}

const sumOf = (courts: AdminBooking[], key: 'total_amount' | 'booking_fee' | 'amount_due') =>
  courts.reduce((total, c) => total + Math.round(c[key] * 100), 0) / 100

export function CheckoutPanel({ group, openId, onOpen, timeZone, currency, proof, pending, error, onApprove, onReject, now, renderCourt }: Props) {
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  const courts = [...group.bookings].sort((a, b) =>
    Date.parse(a.slot_start) - Date.parse(b.slot_start) || a.court_id.localeCompare(b.court_id))
  const lead = courts.find((c) => c.reference_code === group.lead_reference_code) ?? courts[0]
  const title = `Checkout ${group.lead_reference_code}`
  const status = groupDisplayStatus(courts, now ?? new Date())
  const { payment, amount: paid } = groupPayment(courts)
  const total = sumOf(courts, 'amount_due')
  const fee = sumOf(courts, 'booking_fee')
  const rejections = Math.max(0, ...courts.map((c) => c.rejection_count))
  const online = checkoutOnlinePayments(courts)
  const superseded = courts.some((c) => paymentFlags(c).supersededProofs.length > 0)
  const canReview = payment !== null && courts.some((c) => c.status === 'payment_submitted')

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
    <section className="card stack" aria-label={title}>
      <div className="page-head">
        <h2>{title}</h2>
        <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>
      </div>
      <dl className="facts">
        <div><dt>Customer</dt><dd>{lead.guest_name}</dd></div>
        {lead.guest_phone && <div><dt>Phone</dt><dd><a href={`tel:${lead.guest_phone}`}>{lead.guest_phone}</a></dd></div>}
        {lead.guest_email && <div><dt>Email</dt><dd>{lead.guest_email}</dd></div>}
        <div><dt>Court price</dt><dd>{formatMoney(sumOf(courts, 'total_amount'), currency)}</dd></div>
        {fee > 0 && <div><dt>Booking fee</dt><dd>{formatMoney(fee, currency)}</dd></div>}
        <div><dt>Checkout total</dt><dd>{formatMoney(total, currency)}</dd></div>
        {rejections > 0 && <div><dt>Rejections</dt><dd>{rejections}</dd></div>}
      </dl>

      <ul className="list checkout-courts" aria-label="Courts in this checkout">
        {courts.map((c) => (
          <CourtRow key={c.id} court={c} open={c.id === openId} onToggle={() => onOpen(c.id === openId ? null : c.id)}
            timeZone={timeZone} currency={currency} now={now}>
            {c.id === openId && renderCourt(c)}
          </CourtRow>
        ))}
      </ul>

      {online.length > 0 && (
        // Paid on PayMongo and recorded by its webhook: nothing to review here (SPEC §4).
        <div className="stack">
          <h3>Online payments</h3>
          <ul className="list">
            {online.map((p) => (
              <li key={p.provider_payment_id ?? p.id} className="list-row">
                <span className="small">
                  {paymentLabel(p)}{sourceLabel(p.provider_source) ? ` · ${sourceLabel(p.provider_source)}` : ''} · {formatMoney(p.amount, currency)}
                  <span className="muted block">
                    {p.provider_payment_id} · paid {formatDateTimeInZone(p.reviewed_at ?? p.submitted_at, timeZone)}
                  </span>
                  {p.review_status === 'rejected' && p.review_note && <span className="muted block">{p.review_note}</span>}
                </span>
                <span className={`badge review-${p.review_status}`}>{p.review_status === 'approved' ? 'Accepted' : 'Not accepted'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {superseded && (
        <p className="form-warning" role="status">
          The customer paid online after uploading a proof, so the proof was closed automatically. Check it for a duplicate
          payment and refund outside the app if needed.
        </p>
      )}

      {payment ? (
        <div className="stack">
          <h3>Proof waiting for review</h3>
          <p className="small">
            {paymentLabel(payment)} · {formatMoney(paid, currency)}
            {payment.reference_number ? ` · Ref ${payment.reference_number}` : ''} · {formatDateTimeInZone(payment.submitted_at, timeZone)}
          </p>
          {amountMismatch(String(paid), total) && (
            <p className="form-warning" role="status">
              Paid {formatMoney(paid, currency)} but the total is {formatMoney(total, currency)}.
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
          <p className="small">This decides all {courts.length} courts at once.</p>
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

function CourtRow({ court, open, onToggle, timeZone, currency, now, children }: {
  court: AdminBooking; open: boolean; onToggle: () => void; timeZone: string; currency: string; now?: Date; children: ReactNode
}) {
  const status = displayStatus(court, now)
  const date = todayInZone(timeZone, new Date(court.slot_start))
  const detailsId = `court-${court.id}-actions`
  return (
    <li className="stack checkout-court">
      <div className="list-row">
        <span className="small">
          <strong>{court.court_name}</strong> · {formatDateLabel(date, timeZone)}, {formatHour(hourInZone(court.slot_start, timeZone))}–{formatHour(hourInZone(court.slot_end, timeZone))}
          <span className="muted block">{court.reference_code} · {formatMoney(court.amount_due, currency)}</span>
        </span>
        <span className="list-row-end">
          <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>
          <button type="button" className="btn btn-small btn-outline" aria-expanded={open} aria-controls={open ? detailsId : undefined} onClick={onToggle}>
            Manage{' '}<span className="sr-only">{court.reference_code}</span>
          </button>
        </span>
      </div>
      {open && (
        <div id={detailsId} className="stack">
          {court.status === 'cancelled' && (
            <p className="small">
              Cancelled {court.cancelled_by_venue ? 'by staff' : 'by the customer'}
              {court.cancelled_at ? ` on ${formatDateTimeInZone(court.cancelled_at, timeZone)}` : ''}
              {court.cancel_reason ? `: ${court.cancel_reason}` : '.'}
            </p>
          )}
          {children}
        </div>
      )}
    </li>
  )
}
