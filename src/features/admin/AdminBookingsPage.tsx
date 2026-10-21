import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { formatHour, formatMoney } from '../../lib/format'
import { formatDateLabel, hourInZone, todayInZone } from '../../lib/time'
import { useVenueSettings } from '../catalog/hooks'
import { displayStatus, STATUS_LABELS, type BookingStatus } from '../booking/status'
import { adminCanCancel } from '../booking/cancellation'
import { ADMIN_LIST_LIMIT, hasApprovedPayment, pendingPayment, type AdminBooking } from './api'
import { hasPaidOnline, paymentFlags } from './paymentFlags'
import { AdminCancelForm } from './AdminCancelForm'
import { filtersFromParams, filtersToParams, type BookingFilters } from './bookingFilters'
import { BookingFiltersBar } from './BookingFiltersBar'
import { useAdminBookings, useAdminCancelBooking, useProofUrl, useReviewPayment } from './hooks'
import { ReviewPanel, type ProofLink } from './ReviewPanel'

export function AdminBookingsPage() {
  const settings = useVenueSettings()
  const [params, setParams] = useSearchParams()
  const filters = filtersFromParams(params)
  const bookings = useAdminBookings(filters, settings.data?.timezone)
  // `?booking=<id>` opens that booking straight away (the dashboard day view links here, T9.8).
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get('booking'))
  const [lastReview, setLastReview] = useState<{ ref: string; status: BookingStatus } | null>(null)

  const tz = settings.data?.timezone ?? 'Asia/Manila'
  const currency = settings.data?.currency ?? 'PHP'
  // Derived, not synced: a booking that leaves the current filter (e.g. just approved) closes its panel.
  const selected = bookings.data?.bookings.find((b) => b.id === selectedId) ?? null

  function changeFilters(next: BookingFilters) {
    setParams(filtersToParams(next), { replace: true })
    setSelectedId(null)
    setLastReview(null)
  }

  return (
    <section className="page">
      <h1>Bookings</h1>
      <BookingFiltersBar filters={filters} onChange={changeFilters} />
      {lastReview && (
        <div className="alert alert-info" role="status"><p>{reviewOutcome(lastReview.ref, lastReview.status)}</p></div>
      )}
      {settings.isError ? (
        <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} />
      ) : bookings.isPending ? (
        <PageLoader />
      ) : bookings.isError ? (
        <ErrorMessage error={bookings.error} onRetry={() => bookings.refetch()} />
      ) : bookings.data.bookings.length === 0 ? (
        <p className="muted">{filters.status === 'payment_submitted' ? 'No proofs are waiting for review.' : 'No bookings match these filters.'}</p>
      ) : (
        <div className="admin-split">
          <div>
          {bookings.data.truncated && (
            <p className="muted small">Showing the {ADMIN_LIST_LIMIT} most relevant bookings. Pick a date to see a specific day.</p>
          )}
          <ul className="list card flush" aria-label="Bookings">
            {bookings.data.bookings.map((b) => (
              <li key={b.id}>
                <button type="button" className={`list-row row-button${b.id === selectedId ? ' selected' : ''}`}
                  aria-pressed={b.id === selectedId} onClick={() => setSelectedId(b.id)}>
                  <BookingRow booking={b} timeZone={tz} currency={currency} />
                </button>
              </li>
            ))}
          </ul>
          </div>
          {selected && (
            // On phones the panel sits below the list: bring it into view when a booking is picked.
            <div ref={(el) => el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })}>
              <ReviewContainer key={selected.id} booking={selected} timeZone={tz} currency={currency}
                onReviewed={(status) => setLastReview({ ref: selected.reference_code, status })} />
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export function BookingRow({ booking, timeZone, currency }: { booking: AdminBooking; timeZone: string; currency: string }) {
  const status = displayStatus(booking)
  const date = todayInZone(timeZone, new Date(booking.slot_start))
  const flags = paymentFlags(booking)
  return (
    <>
      <span>
        <strong>{booking.reference_code}</strong> · {booking.guest_name}
        <span className="muted small block">
          {booking.court_name} · {formatDateLabel(date, timeZone)} {formatHour(hourInZone(booking.slot_start, timeZone))}
          {booking.source === 'walk_in' ? ' · Walk-in' : ''}
        </span>
      </span>
      <span className="list-row-end">
        <span>{formatMoney(booking.total_amount, currency)}</span>
        <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>
        {hasPaidOnline(booking) && <span className="badge review-approved">Paid online</span>}
        {flags.refundDue.length > 0 && <span className="badge review-rejected">Refund due</span>}
        {flags.supersededProofs.length > 0 && <span className="badge review-pending">Check duplicate</span>}
      </span>
    </>
  )
}

function reviewOutcome(ref: string, status: BookingStatus) {
  if (status === 'confirmed') return `${ref} is confirmed.`
  if (status === 'pending_payment') return `${ref}: proof rejected. The player has a new payment window to upload another proof.`
  if (status === 'rejected') return `${ref}: proof rejected for the last time. The booking is cancelled and the slot released.`
  if (status === 'cancelled') return `${ref} is cancelled and the slot released.`
  return `${ref} is now ${STATUS_LABELS[status].toLowerCase()}.`
}

type ReviewContainerProps = {
  booking: AdminBooking
  timeZone: string
  currency: string
  onReviewed: (status: BookingStatus) => void
}

function ReviewContainer({ booking, timeZone, currency, onReviewed }: ReviewContainerProps) {
  const path = pendingPayment(booking)?.storage_path ?? null
  const proofUrl = useProofUrl(path)
  const review = useReviewPayment()
  const cancel = useAdminCancelBooking()
  const proof: ProofLink = !path
    ? { state: 'none' }
    : proofUrl.isPending
      ? { state: 'loading' }
      : proofUrl.isError
        ? { state: 'error' }
        : { state: 'ready', url: proofUrl.data }

  return (
    <div className="stack">
      <ReviewPanel
        booking={booking}
        timeZone={timeZone}
        currency={currency}
        proof={proof}
        pending={review.isPending}
        error={review.isError ? review.error : null}
        onApprove={() => review.mutate({ bookingId: booking.id, approve: true, note: null }, { onSuccess: (s) => s && onReviewed(s) })}
        onReject={(note) => review.mutate({ bookingId: booking.id, approve: false, note }, { onSuccess: (s) => s && onReviewed(s) })}
      />
      {adminCanCancel(booking, new Date()) && (
        <AdminCancelForm paid={hasApprovedPayment(booking)} pending={cancel.isPending} error={cancel.isError ? cancel.error : null}
          onCancel={(reason) => cancel.mutate({ bookingId: booking.id, reason }, { onSuccess: (s) => onReviewed(s) })} />
      )}
    </div>
  )
}
