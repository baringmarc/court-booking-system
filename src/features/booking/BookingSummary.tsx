import type { ReactNode } from 'react'
import { SimpleMarkdown } from '../../components/SimpleMarkdown'
import { formatHour, formatMoney } from '../../lib/format'
import { formatDateLabel, hourInZone, todayInZone } from '../../lib/time'
import { SPORT_LABELS } from '../catalog/api'
import type { BookingDetail } from './api'
import { formatRemaining } from './countdown'
import { MoveHistory } from './MoveHistory'
import { PaymentHistory } from './PaymentHistory'
import { displayStatus, STATUS_LABELS } from './status'
import { isReplacedByOnlinePayment } from './paymentLabels'

type Props = {
  booking: BookingDetail
  paymentInstructions: string
  timeZone: string
  currency: string
  now: Date
  /** Rendered while the booking is waiting for a proof (the page owns the upload mutation). */
  proofForm?: ReactNode
  /** The venue's payment accounts and QR codes (T11.11), above the free-text instructions. */
  paymentAccounts?: ReactNode
  /** "Pay online with PayMongo", shown above the manual instructions while payable (the page owns the checkout). */
  payOnline?: ReactNode
  /** The PayMongo return message, shown under the booking details. */
  paymentNotice?: ReactNode
  /** The cancel card (the page owns the cancel mutation); it renders nothing once the booking is inactive. */
  cancelSection?: ReactNode
}

export function BookingSummary({ booking, paymentInstructions, timeZone, currency, now, proofForm, paymentAccounts, payOnline, paymentNotice, cancelSection }: Props) {
  const status = displayStatus(booking, now)
  const date = todayInZone(timeZone, new Date(booking.slot_start))
  const hours = Math.round((Date.parse(booking.slot_end) - Date.parse(booking.slot_start)) / 3_600_000)
  const awaitingPayment = status === 'pending_payment'
  // Only proofs count as rejections: a PayMongo payment that wasn't accepted is a refund case, not a failed proof.
  const lastRejection = [...booking.payments].reverse()
    .find((p) => p.review_status === 'rejected' && p.method !== 'paymongo' && !isReplacedByOnlinePayment(p, booking.payments))

  return (
    <div className="stack">
      <section className="card">
        <div className="page-head card-head">
          <h2>{booking.court_name}</h2>
          <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>
        </div>
        <dl className="facts">
          <div><dt>Reference</dt><dd>{booking.reference_code}</dd></div>
          {booking.sport && <div><dt>Sport</dt><dd>{SPORT_LABELS[booking.sport]}</dd></div>}
          <div><dt>Date</dt><dd>{formatDateLabel(date, timeZone)}</dd></div>
          <div>
            <dt>Time</dt>
            <dd>
              {formatHour(hourInZone(booking.slot_start, timeZone))}–{formatHour(hourInZone(booking.slot_end, timeZone))}
              {' '}({hours} {hours === 1 ? 'hour' : 'hours'})
            </dd>
          </div>
          <div><dt>Court price</dt><dd>{formatMoney(booking.total_amount, currency)}</dd></div>
          {booking.booking_fee > 0 && <div><dt>Booking fee</dt><dd>{formatMoney(booking.booking_fee, currency)}</dd></div>}
          <div><dt>Total</dt><dd>{formatMoney(booking.amount_due, currency)}</dd></div>
          <div><dt>Name</dt><dd>{booking.guest_name}</dd></div>
        </dl>
      </section>

      {paymentNotice}

      {awaitingPayment && booking.expires_at && (
        <section className="card stack" aria-labelledby="pay-heading">
          <h2 id="pay-heading" className="card-head rose">Pay within <span className="countdown" role="timer">{formatRemaining(Date.parse(booking.expires_at) - now.getTime())}</span></h2>
          <p className="muted small">
            We hold these times until the timer runs out. Pay {formatMoney(booking.amount_due, currency)} using one of the
            options below, with <strong>{booking.reference_code}</strong> as the payment note.
          </p>
          {lastRejection && (
            <div className="alert alert-error" role="alert">
              <p>Your last proof was not accepted{lastRejection.review_note ? `: ${lastRejection.review_note}` : '.'}</p>
              <p>Please upload a new proof before the timer runs out.</p>
            </div>
          )}
          {payOnline && (
            <>
              <h3>Pay online</h3>
              {payOnline}
              <h3>Or pay manually</h3>
            </>
          )}
          {paymentAccounts}
          <div className="instructions"><SimpleMarkdown text={paymentInstructions} /></div>
          <h3>Upload your proof</h3>
          {proofForm}
        </section>
      )}

      {status === 'payment_submitted' && (
        <div className="alert alert-info" role="status">
          <p>Thanks! We're checking your payment. This page updates when staff confirm it.</p>
        </div>
      )}
      {status === 'rejected' && (
        <div className="alert alert-error" role="status">
          <p>We couldn't verify your payment{lastRejection?.review_note ? ` (${lastRejection.review_note})` : ''}, so this booking was cancelled and the times were released.</p>
        </div>
      )}

      {status === 'expired' && (
        <div className="alert alert-error" role="status">
          <p>This hold expired before payment was received, so the times were released. You can book again.</p>
        </div>
      )}
      {status === 'cancelled' && (
        <div className="alert alert-error" role="status">
          {booking.cancelled_by_venue ? (
            <p>The venue cancelled this booking{booking.cancel_reason ? `: ${booking.cancel_reason}` : '.'}</p>
          ) : (
            <p>This booking was cancelled{booking.cancel_reason ? ` (${booking.cancel_reason})` : ''}.</p>
          )}
          <p>The times were released.{booking.payments.some((p) => p.review_status === 'approved') ? ' Contact the venue about any refund.' : ''}</p>
        </div>
      )}
      <MoveHistory booking={booking} timeZone={timeZone} />
      {cancelSection}
      <PaymentHistory payments={booking.payments} timeZone={timeZone} currency={currency} />
    </div>
  )
}
