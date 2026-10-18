import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { formatHour, formatMoney } from '../../lib/format'
import { formatDateLabel, hourInZone, todayInZone } from '../../lib/time'
import { useAuth } from '../auth/useAuth'
import { SPORT_LABELS, type Court, type VenueSettings } from '../catalog/api'
import { useCourts, useVenueSettings } from '../catalog/hooks'
import { CheckoutForm } from './CheckoutForm'
import { guestBookingPath } from './guestLink'
import { parseCheckoutSearch, type CheckoutParams } from './checkoutParams'
import type { Contact } from './contact'
import { bookingErrorMessage, isSlotGone } from './errors'
import { useAvailability, useCreateBooking } from './hooks'

export function CheckoutPage() {
  const [params] = useSearchParams()
  const choice = parseCheckoutSearch(params)
  if (!choice) return <Navigate to="/book" replace />
  return <CheckoutLoader choice={choice} />
}

function CheckoutLoader({ choice }: { choice: CheckoutParams }) {
  const settings = useVenueSettings()
  const courts = useCourts()
  const { loading: authLoading } = useAuth()

  return (
    <section className="page narrow">
      <h1>Checkout</h1>
      {settings.isPending || courts.isPending || authLoading ? (
        <PageLoader />
      ) : settings.isError ? (
        <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} />
      ) : courts.isError ? (
        <ErrorMessage error={courts.error} onRetry={() => courts.refetch()} />
      ) : (
        <Checkout choice={choice} settings={settings.data} court={courts.data.find((c) => c.id === choice.courtId)} />
      )}
    </section>
  )
}

function Checkout({ choice, settings, court }: { choice: CheckoutParams; settings: VenueSettings; court: Court | undefined }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile } = useAuth()
  const create = useCreateBooking()

  const tz = settings.timezone
  const date = todayInZone(tz, new Date(choice.start))
  const availability = useAvailability(date)
  const gridLink = `/book?date=${date}${court ? `&sport=${court.sport}` : ''}`

  if (create.isSuccess) return <PageLoader />
  if (availability.isPending) return <PageLoader />
  if (availability.isError) return <ErrorMessage error={availability.error} onRetry={() => availability.refetch()} />

  // Re-check the chosen run against fresh availability and take its prices from the server.
  const courtSlots = availability.data.filter((s) => s.court_id === choice.courtId)
  const first = courtSlots.findIndex((s) => Date.parse(s.slot_start) === Date.parse(choice.start))
  const run = first < 0 ? [] : courtSlots.slice(first, first + choice.slots)
  const available = !!court && run.length === choice.slots && run.every((s) => s.status === 'free')

  if (!available && !create.isPending) {
    return (
      <div className="card stack">
        <p>{create.isError ? bookingErrorMessage(create.error) : 'Sorry, those times are no longer available.'}</p>
        <Link to={gridLink} className="btn">Pick another time</Link>
      </div>
    )
  }

  const total = run.reduce((sum, s) => sum + s.price, 0)
  const end = run.at(-1)?.slot_end ?? choice.start
  const isGuest = !user
  const initial: Contact = isGuest
    ? { name: '', email: '', phone: '' }
    : { name: profile?.full_name ?? '', email: user.email ?? '', phone: profile?.phone ?? '' }

  function handleSubmit(contact: Contact) {
    create.mutate(
      {
        courtId: choice.courtId,
        start: choice.start,
        slots: choice.slots,
        contact: isGuest ? contact : { name: contact.name, phone: contact.phone || undefined },
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
        <h2>{court?.name}</h2>
        <dl className="facts">
          <div><dt>Sport</dt><dd>{court ? SPORT_LABELS[court.sport] : ''}</dd></div>
          <div><dt>Date</dt><dd>{formatDateLabel(date, tz)}</dd></div>
          <div>
            <dt>Time</dt>
            <dd>{formatHour(hourInZone(choice.start, tz))}–{formatHour(hourInZone(end, tz))} ({choice.slots} {choice.slots === 1 ? 'hour' : 'hours'})</dd>
          </div>
          <div><dt>Total</dt><dd>{formatMoney(total, settings.currency)}</dd></div>
        </dl>
        <p className="muted small">
          After you confirm, we hold these times for {settings.payment_hold_minutes} minutes while you pay by GCash, Maya or bank transfer.
        </p>
        <Link to={gridLink} className="small">Change time</Link>
      </section>

      {create.isError && (
        <div className="alert alert-error" role="alert">
          <p>{bookingErrorMessage(create.error)}</p>
          {isSlotGone(create.error) && <Link to={gridLink}>Pick another time</Link>}
        </div>
      )}

      <section className="card stack">
        <h2>Your details</h2>
        {isGuest && (
          <p className="muted small">
            Booking as a guest.{' '}
            <Link to="/login" state={{ from: location.pathname + location.search }}>Log in</Link> to fill this in and keep the booking in your account.
          </p>
        )}
        <CheckoutForm key={user?.id ?? 'guest'} initial={initial} isGuest={isGuest} pending={create.isPending} onSubmit={handleSubmit} />
      </section>
    </div>
  )
}
