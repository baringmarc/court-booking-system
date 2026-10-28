import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { useAuth } from '../auth/useAuth'
import { useVenueSettings } from '../catalog/hooks'
import { VenueLocation } from '../venue/VenueInfo'
import { BookingSummary } from './BookingSummary'
import { CancelBooking } from './CancelBooking'
import { playerCancel } from './cancellation'
import { bookingErrorCode } from './errors'
import type { BookingDetail } from './api'
import { readGuestToken, tokenHash } from './guestLink'
import { useBooking, useCancelBooking, useStartPaymongoCheckout, useSubmitPaymentProof } from './hooks'
import { PaymongoReturnNotice, PayOnline, type PayOnlineState } from './PayOnline'
import { paymongoReturnState, readPaidParam, readReturnState, recallCheckoutStart, returnPollMs, tokenToRestore } from './paymongoReturn'
import { ProofForm } from './ProofForm'
import { useNow } from './useNow'
import { errorMessage } from '../../lib/errors'

export function BookingPage() {
  const { ref = '' } = useParams()
  const location = useLocation()
  const { token, rewriteTo } = readGuestToken(location.search, location.hash)
  const justBooked = (location.state as { justBooked?: boolean } | null)?.justBooked === true
  // Back from PayMongo (?paid=1 or ?paid=0): a guest's token comes back from this tab's storage (SPEC §4), and the
  // return moves from the URL into history state so later copies of the link don't re-enter it.
  const paidInUrl = readPaidParam(location.search)
  const paid = paidInUrl ?? readReturnState(location.state)
  const restoredToken = tokenToRestore(ref, token, paidInUrl)
  const [returnedAt] = useState(() => Date.now())
  const [checkoutStartedAt] = useState(() => recallCheckoutStart(ref))
  const { user, isAdmin, loading: authLoading } = useAuth()
  const settings = useVenueSettings()
  // Without a token, only a logged-in owner (or admin) can read the booking.
  const canLoad = token !== null || !!user
  const now = useNow()
  const elapsed = now.getTime() - returnedAt
  const booking = useBooking(canLoad ? ref : undefined, token, {
    pollMs: (b) => returnPollMs(paymongoReturnState(paid, b, elapsed, checkoutStartedAt)),
  })

  // Old ?token= links: move the token into the fragment (no server ever sees it) and keep the page state.
  if (rewriteTo) return <Navigate replace to={{ pathname: location.pathname, ...rewriteTo }} state={location.state} />
  if (paidInUrl) {
    const hash = restoredToken ? tokenHash(restoredToken) : location.hash
    const state = { ...(location.state as object | null), paymongoReturn: paidInUrl }
    return <Navigate replace to={{ pathname: location.pathname, hash }} state={state} />
  }
  const returnState = booking.data ? paymongoReturnState(paid, booking.data, elapsed, checkoutStartedAt) : null

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
            <p>{errorMessage(booking.error)}</p>
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
            paymentNotice={<PaymongoReturnNotice state={returnState} />}
            // Not while we wait for PayMongo's confirmation (no second payment), and not for staff viewing someone
            // else's booking without its link (create-paymongo-checkout only authorizes the owner or the guest token).
            // An admin's own booking is theirs to pay.
            payOnline={returnState === 'confirming' || (isAdmin && token === null && booking.data.user_id !== user?.id)
              ? undefined
              : <PayOnlineButton reference={booking.data.reference_code} token={token} />}
            proofForm={
              // A new attempt round (after a rejection) remounts this, clearing any earlier upload error.
              <ProofUpload key={booking.data.payments.length} booking={booking.data} token={token} currency={settings.data.currency} />
            }
            cancelSection={
              <CancelSection booking={booking.data} token={token} timeZone={settings.data.timezone}
                cutoffHours={settings.data.cancel_cutoff_hours} now={now} />
            }
          />
          <VenueLocation address={settings.data.address} mapsUrl={settings.data.maps_url} />
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

function PayOnlineButton({ reference, token }: { reference: string; token: string | null }) {
  const checkout = useStartPaymongoCheckout(reference, token)
  const { reset } = checkout
  // Back from PayMongo through the back/forward cache: the page is restored as it was ("Taking you to PayMongo…").
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) reset() }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [reset])
  // isSuccess: the browser is already on its way to PayMongo, so the page stays busy until it leaves (T9.11f).
  const state: PayOnlineState = checkout.isPending ? 'opening' : checkout.isSuccess ? 'redirecting' : 'idle'
  return <PayOnline state={state} error={checkout.isError ? checkout.error : null} onPay={() => checkout.mutate()} />
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
      <h2 className={`card-head${prominent ? ' rose' : ''}`}>Save this link</h2>
      <p className="small">It's the only way to view and pay for this booking without an account. Bookmark it or copy it somewhere safe.</p>
      <div className="copy-row">
        <input readOnly value={url} aria-label="Private booking link" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btn-small" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
      </div>
      <p className="small muted">Lost it later? Sign up with the email you booked with to find this booking in My bookings.</p>
    </section>
  )
}
