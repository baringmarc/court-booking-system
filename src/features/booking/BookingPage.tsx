import { useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { useAuth } from '../auth/useAuth'
import { useVenueSettings } from '../catalog/hooks'
import { BookingSummary } from './BookingSummary'
import { bookingErrorCode } from './errors'
import type { BookingDetail } from './api'
import { useBooking, useSubmitPaymentProof } from './hooks'
import { ProofForm } from './ProofForm'
import { useNow } from './useNow'

export function BookingPage() {
  const { ref = '' } = useParams()
  const [params] = useSearchParams()
  const token = params.get('token')
  const location = useLocation()
  const justBooked = (location.state as { justBooked?: boolean } | null)?.justBooked === true
  const { user, loading: authLoading } = useAuth()
  const settings = useVenueSettings()
  // Without a token, only a logged-in owner (or admin) can read the booking.
  const canLoad = token !== null || !!user
  const booking = useBooking(canLoad ? ref : undefined, token)
  const now = useNow()

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
    </section>
  )
}
