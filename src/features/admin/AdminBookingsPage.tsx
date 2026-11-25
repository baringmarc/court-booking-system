import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { formatHour, formatMoney } from '../../lib/format'
import { formatDateLabel, hourInZone, todayInZone } from '../../lib/time'
import { useNow } from '../booking/useNow'
import { useVenueSettings } from '../catalog/hooks'
import { displayStatus, STATUS_LABELS, type BookingStatus } from '../booking/status'
import { adminCanCancel, isActive } from '../booking/cancellation'
import { ADMIN_LIST_LIMIT, hasApprovedPayment, pendingPayment, type AdminBooking, type AdminGroup } from './api'
import { CheckoutPanel } from './CheckoutPanel'
import { groupPayment, reviewQueueEntries } from './groups'
import { hasPaidOnline, paymentFlags } from './paymentFlags'
import { AdminCancelForm } from './AdminCancelForm'
import { filtersFromParams, filtersToParams, parseSearch, type BookingFilters } from './bookingFilters'
import { BookingFiltersBar, BookingSearchForm } from './BookingFiltersBar'
import { useActiveMovedParts, useAdminBookings, useAdminCancelBooking, useAdminGroup, useProofUrl, useReviewPayment, useUpdateRefund } from './hooks'
import { hasOwedRefund, REFUND_STATUS_LABELS } from './refunds'
import { RefundCard } from './RefundCard'
import { RescheduleSection } from './RescheduleSection'
import { ReviewPanel, type ProofLink } from './ReviewPanel'

export function AdminBookingsPage() {
  const settings = useVenueSettings()
  const [params, setParams] = useSearchParams()
  const filters = filtersFromParams(params)
  const bookings = useAdminBookings(filters, settings.data?.timezone)
  // `?booking=<id>` opens that booking straight away (the dashboard day view links here, T9.8).
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get('booking'))
  const [lastReview, setLastReview] = useState<string | null>(null)
  const [lastMove, setLastMove] = useState<string | null>(null)
  // A saved refund (T30.6): under the "Refund owed" filter the booking then leaves the list, so say what was saved.
  const [lastRefund, setLastRefund] = useState<string | null>(null)

  const tz = settings.data?.timezone ?? 'Asia/Manila'
  const currency = settings.data?.currency ?? 'PHP'
  const search = parseSearch(filters.q)
  const searching = search.kind === 'text'
  // Derived, not synced: a booking that leaves the current filter (e.g. just approved) closes its panel. A search for
  // a whole reference code opens that booking (T11.5b) until another one is picked.
  const codeMatch = search.kind === 'text' && search.code ? bookings.data?.bookings.find((b) => b.reference_code === search.code) : undefined
  const selected = bookings.data?.bookings.find((b) => b.id === selectedId) ?? (selectedId === null ? codeMatch ?? null : null)
  // The review queue shows a checkout once (T33.4); every other view lists each court as its own booking.
  const reviewQueue = !searching && filters.status === 'payment_submitted'
  const entries = bookings.data
    ? reviewQueue ? reviewQueueEntries(bookings.data.bookings) : bookings.data.bookings.map((b) => ({ booking: b, courts: [b] }))
    : []

  function changeFilters(next: BookingFilters) {
    setParams(filtersToParams(next), { replace: true })
    setSelectedId(null)
    setLastReview(null)
    setLastMove(null)
    setLastRefund(null)
  }

  return (
    <section className="page">
      <h1>Bookings</h1>
      <BookingSearchForm key={filters.q} value={filters.q} onSearch={(q) => changeFilters({ ...filters, q })} />
      {searching ? (
        <div className="alert alert-info search-note" role="status">
          <p>Searching all bookings for “{filters.q}”. The status, source, date and refund filters are set aside.</p>
          <button type="button" className="btn btn-small btn-outline" onClick={() => changeFilters({ ...filters, q: '' })}>Clear search</button>
        </div>
      ) : null}
      <BookingFiltersBar filters={filters} onChange={changeFilters} />
      {lastReview && (
        <div className="alert alert-info" role="status"><p>{lastReview}</p></div>
      )}
      {lastMove && <div className="alert alert-info" role="status"><p>{lastMove}</p></div>}
      {lastRefund && <div className="alert alert-info" role="status"><p>{lastRefund}</p></div>}
      {settings.isError ? (
        <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} />
      ) : bookings.isPending ? (
        <PageLoader />
      ) : bookings.isError ? (
        <ErrorMessage error={bookings.error} onRetry={() => bookings.refetch()} />
      ) : bookings.data.bookings.length === 0 ? (
        <p className="muted">
          {searching
            ? `No bookings match “${filters.q}”.`
            : filters.refund === 'owed'
              ? 'No bookings with a refund owed match these filters.'
              : filters.status === 'payment_submitted' ? 'No proofs are waiting for review.' : 'No bookings match these filters.'}
        </p>
      ) : (
        <div className="admin-split">
          <div>
          {bookings.data.truncated && (
            <p className="muted small">Showing the {ADMIN_LIST_LIMIT} most relevant bookings. Pick a date to see a specific day.</p>
          )}
          <ul className="list card flush" aria-label="Bookings">
            {entries.map(({ booking: b, courts }) => (
              <li key={b.id}>
                <button type="button" className={`list-row row-button${b.id === selected?.id ? ' selected' : ''}`}
                  aria-pressed={b.id === selected?.id} onClick={() => setSelectedId(b.id)}>
                  <BookingRow booking={b} courts={courts} timeZone={tz} currency={currency} />
                </button>
              </li>
            ))}
          </ul>
          </div>
          {selected && (
            // On phones the panel sits below the list: bring it into view when a booking is picked.
            <div ref={(el) => el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })}>
              {selected.booking_group_id ? (
                // Any court of a checkout opens the whole checkout (T33.6); from the review queue no court is open.
                <CheckoutContainer key={selected.id} booking={selected} groupId={selected.booking_group_id} openFirst={reviewQueue ? null : selected.id}
                  timeZone={tz} currency={currency}
                  onReviewed={(message) => { setLastMove(null); setLastRefund(null); setLastReview(message) }}
                  onMoved={(message) => { setLastReview(null); setLastRefund(null); setLastMove(message) }}
                  onRefunded={(message) => { setLastReview(null); setLastMove(null); setLastRefund(message) }} />
              ) : (
                <ReviewContainer key={selected.id} booking={selected} timeZone={tz} currency={currency}
                  onReviewed={(message) => { setLastMove(null); setLastRefund(null); setLastReview(message) }}
                  onMoved={(message) => { setLastReview(null); setLastRefund(null); setLastMove(message) }}
                  onRefunded={(message) => { setLastReview(null); setLastMove(null); setLastRefund(message) }} />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export function BookingRow({ booking, courts, timeZone, currency }: {
  booking: AdminBooking
  /** In the review queue (T33.4): the checkout's listed bookings this row stands for. */
  courts?: AdminBooking[]
  timeZone: string
  currency: string
}) {
  const status = displayStatus(booking)
  const date = todayInZone(timeZone, new Date(booking.slot_start))
  const flags = paymentFlags(booking)
  const checkout = courts && courts.length > 1 ? courts : null
  const amount = checkout ? checkout.reduce((total, c) => total + Math.round(c.amount_due * 100), 0) / 100 : booking.amount_due
  return (
    <>
      <span>
        <strong>{booking.reference_code}</strong> · {booking.guest_name}
        <span className="muted small block">
          {checkout ? `${checkout.length} courts` : booking.court_name} · {formatDateLabel(date, timeZone)} {formatHour(hourInZone(booking.slot_start, timeZone))}
          {booking.source === 'walk_in' ? ' · Walk-in' : booking.source === 'moved' ? ' · Moved part' : ''}
        </span>
      </span>
      <span className="list-row-end">
        <span>{formatMoney(amount, currency)}</span>
        <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>
        {!checkout && booking.booking_group_id && <span className="badge">Group booking</span>}
        {hasPaidOnline(booking) && <span className="badge review-approved">Paid online</span>}
        {hasOwedRefund(booking) && <span className="badge review-rejected">Refund owed</span>}
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

/** A review decides the whole checkout (T33.6), so its message names the checkout. */
function checkoutReviewOutcome(lead: string, status: BookingStatus, courts: number) {
  if (status === 'confirmed') return `Checkout ${lead} is confirmed (${courts} courts).`
  if (status === 'pending_payment') return `Checkout ${lead}: proof rejected. The player has a new payment window to upload another proof.`
  if (status === 'rejected') return `Checkout ${lead}: proof rejected for the last time. Its courts are cancelled and released.`
  return `Checkout ${lead} is now ${STATUS_LABELS[status].toLowerCase()}.`
}

/** A grouped booking's cancel (SPEC §4): one court once every active court is confirmed, else all of them. */
function groupCancel(group: AdminGroup, booking: AdminBooking, now: Date) {
  const active = group.bookings.filter((b) => isActive(b, now))
  if (active.every((b) => b.status === 'confirmed')) {
    const others = active.filter((b) => b.id !== booking.id).length
    return others > 0 ? { courts: others, scope: 'court' as const } : null
  }
  return { courts: active.length, scope: 'checkout' as const }
}

type ContainerProps = {
  booking: AdminBooking
  timeZone: string
  currency: string
  onReviewed: (message: string) => void
  onMoved: (message: string) => void
  onRefunded: (message: string) => void
}

/**
 * Runs `then` once a mutation succeeds, even if this panel has unmounted meanwhile: a decision usually takes the
 * booking out of the current filter, so the list refetch closes the panel, and `mutate`'s own callbacks are dropped
 * for an unmounted component. Errors are shown from the mutation's state, so the rejection is only swallowed here.
 */
function settle<T>(promise: Promise<T>, then: (value: T) => void) {
  promise.then(then, () => {})
}

const proofLink = (path: string | null, url: { isPending: boolean; isError: boolean; data?: string }): ProofLink =>
  !path ? { state: 'none' } : url.isPending ? { state: 'loading' } : url.isError || !url.data ? { state: 'error' } : { state: 'ready', url: url.data }

function ReviewContainer({ booking, timeZone, currency, onReviewed, onMoved, onRefunded }: ContainerProps) {
  const path = pendingPayment(booking)?.storage_path ?? null
  const proofUrl = useProofUrl(path)
  const review = useReviewPayment()
  const done = (s: BookingStatus | undefined) => { if (s) onReviewed(reviewOutcome(booking.reference_code, s)) }
  return (
    <div className="stack">
      <ReviewPanel
        booking={booking}
        timeZone={timeZone}
        currency={currency}
        proof={proofLink(path, proofUrl)}
        pending={review.isPending}
        error={review.isError ? review.error : null}
        onApprove={() => settle(review.mutateAsync({ bookingId: booking.id, approve: true, note: null }), done)}
        onReject={(note) => settle(review.mutateAsync({ bookingId: booking.id, approve: false, note }), done)}
      />
      <BookingActions booking={booking} timeZone={timeZone} currency={currency} onRefunded={onRefunded} onMoved={onMoved}
        onCancelled={(s) => onReviewed(reviewOutcome(booking.reference_code, s))} />
    </div>
  )
}

/** The whole checkout of a grouped booking (T33.6), read by group id whatever the list's filters. */
function CheckoutContainer({ booking, groupId, openFirst, timeZone, currency, onReviewed, onMoved, onRefunded }: ContainerProps & {
  groupId: string
  /** The court open from the start: the one staff opened, or none from the review queue. */
  openFirst: string | null
}) {
  const groupQuery = useAdminGroup(groupId)
  const [openId, setOpenId] = useState(openFirst)
  const group = groupQuery.data
  // The proof's file sits on one court's payment: preview that one.
  const path = group ? groupPayment(group.bookings).payment?.storage_path ?? null : null
  const proofUrl = useProofUrl(path)
  const review = useReviewPayment()
  if (groupQuery.isPending) return <PageLoader />
  if (groupQuery.isError || !group) {
    // Without the checkout the panel can't say what a cancel covers, so nothing is offered until a retry.
    return <ErrorMessage error={groupQuery.error} onRetry={() => groupQuery.refetch()} />
  }
  const lead = group.bookings.find((b) => b.reference_code === group.lead_reference_code) ?? group.bookings[0] ?? booking
  const done = (s: BookingStatus | undefined) => {
    if (s) onReviewed(checkoutReviewOutcome(group.lead_reference_code, s, group.bookings.length))
  }
  return (
    <CheckoutPanel
      group={group}
      openId={openId}
      onOpen={setOpenId}
      timeZone={timeZone}
      currency={currency}
      proof={proofLink(path, proofUrl)}
      pending={review.isPending}
      error={review.isError ? review.error : null}
      onApprove={() => settle(review.mutateAsync({ bookingId: lead.id, approve: true, note: null }), done)}
      onReject={(note) => settle(review.mutateAsync({ bookingId: lead.id, approve: false, note }), done)}
      renderCourt={(court) => {
        const scope = groupCancel(group, court, new Date())
        return (
          <BookingActions booking={court} scope={scope} timeZone={timeZone} currency={currency} onRefunded={onRefunded} onMoved={onMoved}
            onCancelled={() => onReviewed(scope?.scope === 'checkout'
              ? `Checkout ${group.lead_reference_code} is cancelled and its ${scope.courts} courts released.`
              : `${court.reference_code} (${court.court_name}) is cancelled and the slot released. The other courts stay booked.`)} />
        )
      }}
    />
  )
}

/** One booking's own actions: its refund card, reschedule and cancel form (a court's, inside a checkout's Manage). */
function BookingActions({ booking, scope, timeZone, currency, onRefunded, onMoved, onCancelled }: {
  booking: AdminBooking
  scope?: { courts: number; scope: 'court' | 'checkout' } | null
  timeZone: string
  currency: string
  onRefunded: (message: string) => void
  onMoved: (message: string) => void
  onCancelled: (status: BookingStatus) => void
}): ReactNode {
  const cancel = useAdminCancelBooking()
  const refund = useUpdateRefund()
  // The venue's date: the default refund date and the latest one allowed (update_refund checks it too).
  const today = todayInZone(timeZone, useNow(60_000))
  const canCancel = adminCanCancel(booking, new Date())
  // A moved part isn't cancelled with its booking (T10.1): the cancel form says which ones stay.
  const movedParts = useActiveMovedParts(booking.id, canCancel && booking.source !== 'moved')
  return (
    <>
      <RefundCard refunds={booking.refunds} payments={booking.payments} timeZone={timeZone} currency={currency} today={today}
        pending={refund.isPending} error={refund.isError ? refund.error : null} onUpdate={(input) => settle(refund.mutateAsync(input),
          () => onRefunded(`Refund for ${booking.reference_code} saved: ${REFUND_STATUS_LABELS[input.status]}.`))} />
      <RescheduleSection booking={booking} onMoved={onMoved} />
      {canCancel && (
        <AdminCancelForm paid={hasApprovedPayment(booking)} movedParts={movedParts.data} pending={cancel.isPending} error={cancel.isError ? cancel.error : null}
          group={scope ?? undefined}
          onCancel={(reason) => settle(cancel.mutateAsync({ bookingId: booking.id, reason }), onCancelled)} />
      )}
    </>
  )
}
