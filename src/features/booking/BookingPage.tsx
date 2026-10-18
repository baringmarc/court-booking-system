import { useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { useAuth } from '../auth/useAuth'
import { useVenueSettings } from '../catalog/hooks'
import { BookingSummary } from './BookingSummary'
import { CancelBooking } from './CancelBooking'
import { playerCancel } from './cancellation'
import { bookingErrorCode } from './errors'
import type { BookingDetail } from './api'
import { readGuestToken } from './guestLink'
import { useBooking, useCancelBooking, useSubmitPaymentProof } from './hooks'
import { ProofForm } from './ProofForm'
import { useNow } from './useNow'

export function BookingPage() {
  const { ref = '' } = useParams()
  const location = useLocation()
  const { token, rewriteTo } = readGuestToken(location.search, location.hash)
  const justBooked = (location.state as { justBooked?: boolean } | null)?.justBooked === true
  const { user, loading: authLoading } = useAuth()
  const settings = useVenueSettings()
  // Without a token, only a logged-in owner (or admin) can read the booking.
  const canLoad = token !== null || !!user
  const booking = useBooking(canLoad ? ref : undefined, token)
  const now = useNow()

  // Old ?token= links: move the token into the fragment (no server ever sees it) and keep the page state.
  if (rewriteTo) return <Navigate replace to={{ pathname: location.pathname, ...rewriteTo }} state={location.state} />

  return (
    <section className="page narrow">
      <h1>{justBooked ? 'Booking reserved' : 'Your booking'}</h1>
      {authLoading || settings.isPending || (canLoad && booking.isPending) ? (
        <PageLoader />
      ) : !canLoad ? (
        <div className="card stack">
          <p>Log in to see this booking, or open the private link from your confirmation.</p>
          <Link to="/login" state={{ from: location.pathname }} className="btn">Log in</Link>
        </div>
      ) : settings.isError ? (
        <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} />
      ) : booking.isError ? (
        bookingErrorCode(booking.error) === 'not_found' ? (
          <div className="card stack">
            <p>{booking.error.message}</p>
            {token !== null && !user && (
              <p className="small">
                Lost your link? <Link to="/signup">Sign up</Link> or <Link to="/login">log in</Link> with the email you
                booked with, and your booking will appear in My bookings.
              </p>
            )}
            <Link to="/book" className="btn btn-outline">Book a court</Link>
          </div>
        ) : (
          <ErrorMessage error={booking.error} onRetry={() => booking.refetch()} />
        )
      ) : booking.data ? (
        <div className="stack">
          {token !== null && <SaveLinkCard prominent={justBooked} />}
          <BookingSummary
            booking={booking.data}
            paymentInstructions={settings.data.payment_instructions}
            timeZone={settings.data.timezone}
            currency={settings.data.currency}
            now={now}
            proofForm={
              // A new attempt round (after a rejection) remounts this, clearing any earlier upload error.
              <ProofUpload key={booking.data.payments.length} booking={booking.data} token={token} currency={settings.data.currency} />
            }
            cancelSection={
              <CancelSection booking={booking.data} token={token} timeZone={settings.data.timezone}
                cutoffHours={settings.data.cancel_cutoff_hours} now={now} />
            }
          />
        </div>
      ) : null}
    </section>
  )
}

function ProofUpload({ booking, token, currency }: { booking: BookingDetail; token: string | null; currency: string }) {
  const submitProof = useSubmitPaymentProof(booking.reference_code, token)
  return (
    <ProofForm
      total={booking.total_amount}
      currency={currency}
      pending={submitProof.isPending}
      error={submitProof.isError ? submitProof.error : null}
      onSubmit={(values) => submitProof.mutate(values)}
    />
  )
}

function CancelSection({ booking, token, timeZone, cutoffHours, now }: {
  booking: BookingDetail
  token: string | null
  timeZone: string
  cutoffHours: number
  now: Date
}) {
  const { isAdmin } = useAuth()
  const cancel = useCancelBooking(booking.reference_code, token)
  // Signed in as staff (no guest link), cancel_booking applies the admin rules: reason required, until the end.
  if (isAdmin && token === null) {
    return <p className="muted small">Staff: cancel this booking from <Link to="/admin/bookings?status=all">Admin → Bookings</Link>.</p>
  }
  return (
    <CancelBooking
      check={playerCancel(booking, cutoffHours, now)}
      timeZone={timeZone}
      paid={booking.payments.some((p) => p.review_status === 'approved')}
      pending={cancel.isPending}
      error={cancel.isError ? cancel.error : null}
      onCancel={(reason) => cancel.mutate({ bookingId: booking.id, reason })}
    />
  )
}

/** Guests have no account: this private link is the only way back to the booking. */
function SaveLinkCard({ prominent }: { prominent: boolean }) {
  const [copied, setCopied] = useState(false)
  const url = window.location.href

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className={`card stack${prominent ? ' card-highlight' : ''}`}>
      <h2>Save this link</h2>
      <p className="small">It's the only way to view and pay for this booking without an account. Bookmark it or copy it somewhere safe.</p>
      <div className="copy-row">
        <input readOnly value={url} aria-label="Private booking link" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btn-small" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
      </div>
      <p className="small muted">Lost it later? Sign up with the email you booked with to find this booking in My bookings.</p>
    </section>
  )
}
