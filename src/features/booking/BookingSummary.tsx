import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { SimpleMarkdown } from '../../components/SimpleMarkdown'
import { formatHour, formatMoney } from '../../lib/format'
import { formatDateLabel, formatDateTimeInZone, hourInZone, todayInZone } from '../../lib/time'
import { SPORT_LABELS } from '../catalog/api'
import type { BookingDetail, BookingGroup } from './api'
import { formatRemaining } from './countdown'
import { MoveHistory } from './MoveHistory'
import { PaymentHistory } from './PaymentHistory'
import { displayStatus, STATUS_LABELS, type DisplayStatus } from './status'
import { isReplacedByOnlinePayment } from './paymentLabels'
import { toCheckoutSearch } from './checkoutParams'
import { nextSameTimeStart } from './rebook'
import { RefundNotice } from './RefundNotice'
import { groupDisplayStatus } from './group'

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
  /** A guest's "Save this link" notice, shown after the payment section (T27.3). */
  saveLink?: ReactNode
  /** The venue's address (VenueLocation), shown before the payment history (T27.3). */
  venueLocation?: ReactNode
}

const STEPS = [
  { label: 'Reserved', statuses: ['pending_payment'] },
  { label: 'Payment sent', statuses: ['payment_submitted'] },
  { label: 'Confirmed', statuses: ['confirmed', 'completed'] },
] as const satisfies readonly { label: string; statuses: readonly DisplayStatus[] }[]

/** Reserved → Payment sent → Confirmed; the current step is marked in text and with aria-current, not by color alone. */
function BookingSteps({ status }: { status: DisplayStatus }) {
  const current = STEPS.findIndex((s) => (s.statuses as readonly DisplayStatus[]).includes(status))
  if (current < 0) return null
  return (
    <ol className="booking-steps" aria-label="Booking progress">
      {STEPS.map((step, i) => (
        <li key={step.label} className={i < current ? 'done' : i === current ? 'current' : undefined}
          aria-current={i === current ? 'step' : undefined}>
          {step.label}{i === current && <span className="sr-only"> (current step)</span>}
        </li>
      ))}
    </ol>
  )
}

/** After an expired or rejected hold (T27.5): back to checkout for the same court and time while it's still ahead;
 * checkout sends the player back to the grid if someone else has taken it meanwhile. */
function RetryLink({ booking, hours, now }: { booking: BookingDetail; hours: number; now: Date }) {
  // A group (T33.4): the guest read has no court ids to retry every court with, so it's back to the grid.
  if (booking.group || Date.parse(booking.slot_start) <= now.getTime()) return <p><Link to="/book" className="btn btn-small">Book a court</Link></p>
  const search = toCheckoutSearch({ courtId: booking.court_id, start: booking.slot_start, slots: hours })
  return <p><Link to={`/book/checkout?${search}`} className="btn btn-small">Try this time again</Link></p>
}

/** T30.4: checkout for the same court, weekday and time in the first week still ahead, carrying the reference so the
 * new booking records where it came from. Checkout sends the player back to the grid if that time is taken. */
function SameTimeNextWeek({ booking, hours, timeZone, now }: { booking: BookingDetail; hours: number; timeZone: string; now: Date }) {
  const start = nextSameTimeStart(booking.slot_start, timeZone, now)
  const search = toCheckoutSearch({ courtId: booking.court_id, start, slots: hours, rebook: booking.reference_code })
  return (
    <p>
      <Link to={`/book/checkout?${search}`} className="btn btn-small">
        Same time next week{booking.group && <span className="sr-only">, {booking.court_name}</span>}
      </Link>
    </p>
  )
}

const hoursOf = (start: string, end: string) => Math.round((Date.parse(end) - Date.parse(start)) / 3_600_000)

/** Every court of the checkout (T33.4), each with a badge only when it differs from the group's status. */
function GroupCourts({ group, groupStatus, expiresAt, timeZone, currency, now }: {
  group: BookingGroup; groupStatus: DisplayStatus; expiresAt: string | null; timeZone: string; currency: string; now: Date
}) {
  return (
    <ul className="list group-courts" aria-label="Courts in this booking">
      {group.bookings.map((c) => {
        const status = displayStatus({ status: c.status, slot_end: c.slot_end, expires_at: expiresAt }, now)
        const hours = hoursOf(c.slot_start, c.slot_end)
        return (
          <li key={c.reference_code} className="list-row">
            <span>
              <strong>{c.court_name}</strong>
              <span className="muted small block">
                {c.sport ? `${SPORT_LABELS[c.sport]} · ` : ''}
                {formatDateLabel(todayInZone(timeZone, new Date(c.slot_start)), timeZone)},{' '}
                {formatHour(hourInZone(c.slot_start, timeZone))}–{formatHour(hourInZone(c.slot_end, timeZone))}
                {' '}({hours} {hours === 1 ? 'hour' : 'hours'}) · {c.reference_code}
              </span>
            </span>
            <span className="list-row-end">
              <span>{formatMoney(c.total_amount, currency)}</span>
              {status !== groupStatus && <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

const listFormat = new Intl.ListFormat('en', { type: 'conjunction' })

export function BookingSummary({ booking, paymentInstructions, timeZone, currency, now, proofForm, paymentAccounts, payOnline, paymentNotice, cancelSection, saveLink, venueLocation }: Props) {
  // A grouped booking reads as its whole checkout (T33.4): one status, the group's sums and one payment.
  const group = booking.group && booking.group.bookings.length > 0 ? booking.group : null
  const ownStatus = displayStatus(booking, now)
  const status = group
    ? groupDisplayStatus(group.bookings.map((c) => ({ ...c, expires_at: booking.expires_at })), now)
    : ownStatus
  const amounts = group ?? booking
  const paymentReference = group ? group.lead_reference_code : booking.reference_code
  const cancelledCourts = group && status !== 'cancelled' ? group.bookings.filter((c) => c.status === 'cancelled') : []
  const date = todayInZone(timeZone, new Date(booking.slot_start))
  const hours = hoursOf(booking.slot_start, booking.slot_end)
  const awaitingPayment = status === 'pending_payment'
  // Only proofs count as rejections: a PayMongo payment that wasn't accepted is a refund case, not a failed proof.
  const lastRejection = [...booking.payments].reverse()
    .find((p) => p.review_status === 'rejected' && p.method !== 'paymongo' && !isReplacedByOnlinePayment(p, booking.payments))
  const latestProof = booking.payments.at(-1)
  // Waiting for a new proof (e.g. arriving from the rejection email): bring the payment card into view.
  const payHeading = useRef<HTMLHeadingElement>(null)
  const needsNewProof = awaitingPayment && !!booking.expires_at && !!lastRejection
  useEffect(() => {
    if (!needsNewProof) return
    payHeading.current?.scrollIntoView?.({ block: 'start' })
    payHeading.current?.focus({ preventScroll: true })
  }, [needsNewProof])

  return (
    <div className="stack">
      <BookingSteps status={status} />
      {group ? (
        <section className="card">
          <div className="page-head card-head">
            <h2>Your courts</h2>
            <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>
          </div>
          <GroupCourts group={group} groupStatus={status} expiresAt={booking.expires_at} timeZone={timeZone} currency={currency} now={now} />
          <dl className="facts">
            <div><dt>Reference</dt><dd>{group.lead_reference_code}</dd></div>
            <div><dt>Court price</dt><dd>{formatMoney(group.total_amount, currency)}</dd></div>
            {group.booking_fee > 0 && <div><dt>Booking fee</dt><dd>{formatMoney(group.booking_fee, currency)}</dd></div>}
            <div><dt>Total</dt><dd>{formatMoney(group.amount_due, currency)}</dd></div>
            <div><dt>Name</dt><dd>{booking.guest_name}</dd></div>
          </dl>
          {(ownStatus === 'confirmed' || ownStatus === 'completed') && (
            <SameTimeNextWeek booking={booking} hours={hours} timeZone={timeZone} now={now} />
          )}
        </section>
      ) : (
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
        {(status === 'confirmed' || status === 'completed') && (
          <SameTimeNextWeek booking={booking} hours={hours} timeZone={timeZone} now={now} />
        )}
      </section>
      )}

      {paymentNotice}

      {awaitingPayment && booking.expires_at && (
        <section className="card stack" aria-labelledby="pay-heading">
          <h2 id="pay-heading" ref={payHeading} tabIndex={-1} className="card-head rose">Pay within <span className="countdown" role="timer">{formatRemaining(Date.parse(booking.expires_at) - now.getTime())}</span></h2>
          <p className="muted small">
            We hold these times until the timer runs out. Pay {formatMoney(amounts.amount_due, currency)} using one of the
            options below, with <strong>{paymentReference}</strong> as the payment note.
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

      {saveLink}

      {status === 'payment_submitted' && (
        <div className="alert alert-info" role="status">
          {latestProof && <p>Proof received {formatDateTimeInZone(latestProof.submitted_at, timeZone)}.</p>}
          <p>The venue checks payments by hand. We'll email you when it's confirmed.</p>
        </div>
      )}
      {status === 'rejected' && (
        <div className="alert alert-error" role="status">
          <p>We couldn't verify your payment{lastRejection?.review_note ? ` (${lastRejection.review_note})` : ''}, so this booking was cancelled and the times were released.</p>
          <RetryLink booking={booking} hours={hours} now={now} />
        </div>
      )}

      {status === 'expired' && (
        <div className="alert alert-error" role="status">
          <p>This hold expired before payment was received, so the times were released. You can book again.</p>
          <RetryLink booking={booking} hours={hours} now={now} />
        </div>
      )}
      {status === 'cancelled' && (
        <div className="alert alert-error" role="status">
          {booking.cancelled_by_venue ? (
            <p>The venue cancelled this booking{booking.cancel_reason ? `: ${booking.cancel_reason}` : '.'}</p>
          ) : (
            <p>This booking was cancelled{booking.cancel_reason ? ` (${booking.cancel_reason})` : ''}.</p>
          )}
          {/* With a refund record (T30.5) the Refund card below says what happens; older data falls back to this line. */}
          <p>The times were released.{!(group ? group.bookings.some((c) => c.refund) : booking.refund) && booking.payments.some((p) => p.review_status === 'approved') ? ' Contact the venue about any refund.' : ''}</p>
        </div>
      )}
      {cancelledCourts.length > 0 && (
        <div className="alert alert-error" role="status">
          <p>
            The venue cancelled {listFormat.format(cancelledCourts.map((c) => c.court_name))}
            {ownStatus === 'cancelled' && booking.cancel_reason ? `: ${booking.cancel_reason}` : ''}. The other courts are still booked.
          </p>
        </div>
      )}
      {group
        ? group.bookings.filter((c) => c.refund).map((c) => (
          <RefundNotice key={c.reference_code} title={`Refund: ${c.court_name}`} refund={c.refund} timeZone={timeZone} currency={currency} />
        ))
        : <RefundNotice refund={booking.refund} timeZone={timeZone} currency={currency} />}
      {venueLocation}
      <MoveHistory booking={booking} timeZone={timeZone} />
      {cancelSection}
      <PaymentHistory payments={booking.payments} timeZone={timeZone} currency={currency} />
      {booking.waiver_text && (
        <section className="card stack" aria-labelledby="waiver-heading">
          <h2 id="waiver-heading">Waiver you accepted</h2>
          <p className="pre-line">{booking.waiver_text}</p>
        </section>
      )}
    </div>
  )
}
