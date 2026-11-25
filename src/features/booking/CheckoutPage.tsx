import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { formatHour, formatMoney } from '../../lib/format'
import { formatDateLabel, hourInZone, todayInZone } from '../../lib/time'
import { useAuth } from '../auth/useAuth'
import { SPORT_LABELS, type Court, type PublicSchedulePeriod, type VenueSettings } from '../catalog/api'
import { useCourts, usePublicSchedule, useVenueSettings } from '../catalog/hooks'
import { CheckoutDetails } from './CheckoutDetails'
import { guestBookingPath } from './guestLink'
import { freeRunSlots, parseCheckoutRuns, parseRebookReference, type CheckoutParams, type CheckoutRun } from './checkoutParams'
import { bookingErrorMessage, isSlotGone } from './errors'
import { useAvailability, useCreateBooking, usePlatformFee } from './hooks'
import { GroupCheckout } from './GroupCheckout'
import { promoLabelsOf } from './selection'

export function CheckoutPage() {
  const [params] = useSearchParams()
  const runs = parseCheckoutRuns(params)
  if (!runs) return <Navigate to="/book" replace />
  return <CheckoutLoader runs={runs} />
}

function CheckoutLoader({ runs }: { runs: CheckoutRun[] }) {
  const settings = useVenueSettings()
  const courts = useCourts()
  const hours = usePublicSchedule()
  const { loading: authLoading } = useAuth()

  return (
    <section className="page narrow">
      <h1>Checkout</h1>
      {settings.isPending || courts.isPending || hours.isPending || authLoading ? (
        <PageLoader />
      ) : settings.isError ? (
        <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} />
      ) : courts.isError ? (
        <ErrorMessage error={courts.error} onRetry={() => courts.refetch()} />
      ) : hours.isError ? (
        <ErrorMessage error={hours.error} onRetry={() => hours.refetch()} />
      ) : runs.length > 1 ? (
        // Two or more bookings in one checkout (T33.3): several courts, or several times on one court.
        <GroupCheckout runs={runs} settings={settings.data} courts={courts.data} hours={hours.data} />
      ) : (
        <Checkout choice={runs[0]} settings={settings.data} court={courts.data.find((c) => c.id === runs[0].courtId)} hours={hours.data} />
      )}
    </section>
  )
}

function Checkout({ choice, settings, court, hours }: { choice: CheckoutParams; settings: VenueSettings; court: Court | undefined; hours: PublicSchedulePeriod[] }) {
  const navigate = useNavigate()
  // From a "Same time next week" link (T30.4): the booking being repeated, recorded on the new one by create_booking.
  const [params] = useSearchParams()
  const rebookOfReference = parseRebookReference(params) ?? undefined
  const create = useCreateBooking()

  const tz = settings.timezone
  // The operating date the run belongs to: a 1 AM slot after a 6 AM–5 AM day is listed under the previous date.
  const period = hours.find((p) => p.court_id === choice.courtId && Date.parse(p.period_start) <= Date.parse(choice.start) && Date.parse(choice.start) < Date.parse(p.period_end))
  const date = period?.operating_date ?? todayInZone(tz, new Date(choice.start))
  const availability = useAvailability(date)
  const platformFee = usePlatformFee()
  const gridLink = `/book?date=${date}${court ? `&sport=${court.sport}` : ''}`

  if (create.isSuccess) return <PageLoader />
  if (availability.isPending || platformFee.isPending) return <PageLoader />
  if (availability.isError) return <ErrorMessage error={availability.error} onRetry={() => availability.refetch()} />
  if (platformFee.isError) return <ErrorMessage error={platformFee.error} onRetry={() => platformFee.refetch()} />

  // Re-check the chosen run against fresh availability and take its prices from the server.
  const freeRun = court ? freeRunSlots(choice, availability.data, period) : null
  const run = freeRun ?? []
  const available = freeRun !== null

  if (!available && !create.isPending) {
    return (
      <div className="card stack">
        <p>{create.isError ? bookingErrorMessage(create.error) : 'Sorry, those times are no longer available.'}</p>
        <Link to={gridLink} className="btn">Pick another time</Link>
      </div>
    )
  }

  const courtPrice = run.reduce((sum, s) => sum + s.price, 0)
  const promoLabels = promoLabelsOf(run)
  const fee = platformFee.data
  const end = run.at(-1)?.slot_end ?? choice.start

  function handleSubmit(contact: { name?: string; email?: string; phone?: string }, waiverAccepted: boolean) {
    create.mutate(
      {
        courtId: choice.courtId,
        start: choice.start,
        slots: choice.slots,
        contact,
        waiverAccepted,
        rebookOfReference,
      },
      {
        onSuccess: ({ referenceCode, guestToken }) => {
          const path = guestToken ? guestBookingPath(referenceCode, guestToken) : `/booking/${referenceCode}`
          navigate(path, { replace: true, state: { justBooked: true } })
        },
      },
    )
  }

  return (
    <div className="stack">
      <section className="card">
        <h2 className="card-head">{court?.name}</h2>
        <dl className="facts">
          <div><dt>Sport</dt><dd>{court ? SPORT_LABELS[court.sport] : ''}</dd></div>
          {/* The real calendar date: a 1 AM slot is on the next date, though it's listed under the operating day. */}
          <div><dt>Date</dt><dd>{formatDateLabel(todayInZone(tz, new Date(choice.start)), tz)}</dd></div>
          <div>
            <dt>Time</dt>
            <dd>{formatHour(hourInZone(choice.start, tz))}–{formatHour(hourInZone(end, tz))} ({choice.slots} {choice.slots === 1 ? 'hour' : 'hours'})</dd>
          </div>
          {promoLabels.length > 0 && <div><dt>Promo</dt><dd>{promoLabels.join(', ')}</dd></div>}
          <div><dt>Court price</dt><dd>{formatMoney(courtPrice, settings.currency)}</dd></div>
          {fee > 0 && <div><dt>Booking fee</dt><dd>{formatMoney(fee, settings.currency)}</dd></div>}
          <div><dt>Total</dt><dd>{formatMoney(courtPrice + fee, settings.currency)}</dd></div>
        </dl>
        <p className="muted small">
          After you reserve, we hold these times for {settings.payment_hold_minutes} minutes while you pay by GCash, Maya or bank transfer.
        </p>
        <Link to={gridLink} className="small">Change time</Link>
      </section>

      {create.isError && (
        <div className="alert alert-error" role="alert">
          <p>{bookingErrorMessage(create.error)}</p>
          {isSlotGone(create.error) && <Link to={gridLink}>Pick another time</Link>}
        </div>
      )}

      <CheckoutDetails settings={settings} pending={create.isPending} onSubmit={handleSubmit} />
    </div>
  )
}
