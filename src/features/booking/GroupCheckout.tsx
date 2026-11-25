import { Link, useNavigate } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { formatHour, formatMoney } from '../../lib/format'
import { formatDateLabel, hourInZone, todayInZone } from '../../lib/time'
import { SPORT_LABELS, type CourtWithPhotos, type PublicSchedulePeriod, type VenueSettings } from '../catalog/api'
import { joinNames } from './blocks'
import { CheckoutDetails } from './CheckoutDetails'
import { freeRunSlots, type CheckoutRun } from './checkoutParams'
import { groupBookingErrorMessage, isSlotGone } from './errors'
import { guestBookingPath } from './guestLink'
import { useAvailability, useCreateBookingGroup, usePlatformFee } from './hooks'
import { promoLabelsOf } from './selection'

const hours = (n: number) => `${n} ${n === 1 ? 'hour' : 'hours'}`

/**
 * Checkout of two or more runs (several courts, or several times on one court; T33.3): one hold, one booking fee and one
 * payment through create_booking_group. Each run is still its own booking.
 */
export function GroupCheckout({ runs, settings, courts, hours: periods }: {
  runs: CheckoutRun[]
  settings: VenueSettings
  courts: CourtWithPhotos[]
  hours: PublicSchedulePeriod[]
}) {
  const navigate = useNavigate()
  const create = useCreateBookingGroup()
  const tz = settings.timezone

  const periodOf = (run: CheckoutRun) => periods.find((p) => p.court_id === run.courtId
    && Date.parse(p.period_start) <= Date.parse(run.start) && Date.parse(run.start) < Date.parse(p.period_end))
  // Every run of one checkout is on one operating date: the first run's.
  const date = periodOf(runs[0])?.operating_date ?? todayInZone(tz, new Date(runs[0].start))
  const availability = useAvailability(date)
  const platformFee = usePlatformFee()
  const courtOf = (id: string) => courts.find((c) => c.id === id)
  const firstCourt = courtOf(runs[0].courtId)
  const gridLink = `/book?date=${date}${firstCourt ? `&sport=${firstCourt.sport}` : ''}`

  if (create.isSuccess) return <PageLoader />
  if (availability.isPending || platformFee.isPending) return <PageLoader />
  if (availability.isError) return <ErrorMessage error={availability.error} onRetry={() => availability.refetch()} />
  if (platformFee.isError) return <ErrorMessage error={platformFee.error} onRetry={() => platformFee.refetch()} />

  // Re-check every run against fresh availability and take its prices from the server.
  const checked = runs.map((run) => {
    const period = periodOf(run)
    const slots = courtOf(run.courtId) && period?.operating_date === date ? freeRunSlots(run, availability.data, period) : null
    return { run, slots }
  })
  const unavailable = checked.filter((c) => !c.slots)
  const startLabel = (run: CheckoutRun) => `${courtOf(run.courtId)?.name ?? 'A court'} at ${formatHour(hourInZone(run.start, tz))}`

  if (unavailable.length > 0 && !create.isPending) {
    return (
      <div className="card stack">
        <p>{`Sorry, ${joinNames(unavailable.map((c) => startLabel(c.run)))} ${unavailable.length === 1 ? 'is' : 'are'} no longer available.`}</p>
        <Link to={gridLink} className="btn">Pick another time</Link>
      </div>
    )
  }

  const priced = checked.map(({ run, slots }) => ({ run, slots: slots ?? [], price: (slots ?? []).reduce((sum, s) => sum + s.price, 0) }))
  const courtPrice = priced.reduce((sum, r) => sum + r.price, 0)
  const fee = platformFee.data

  function handleSubmit(contact: { name?: string; email?: string; phone?: string }, waiverAccepted: boolean) {
    create.mutate(
      { items: runs.map(({ courtId, start, slots }) => ({ courtId, start, slots })), contact, waiverAccepted },
      {
        onSuccess: ({ bookings, guestToken }) => {
          // The lead (first) booking's page; T33.4 shows the whole group there.
          const lead = bookings[0].referenceCode
          navigate(guestToken ? guestBookingPath(lead, guestToken) : `/booking/${lead}`, { replace: true, state: { justBooked: true } })
        },
      },
    )
  }

  return (
    <div className="stack">
      <section className="card">
        <h2 className="card-head">Your courts</h2>
        <ul className="checkout-runs" aria-label="Courts and times">
          {priced.map(({ run, slots, price }) => {
            const court = courtOf(run.courtId)
            const end = slots.at(-1)?.slot_end ?? run.start
            const promos = promoLabelsOf(slots)
            return (
              <li key={`${run.courtId}-${run.start}`}>
                <div className="checkout-run-head">
                  <strong>{court?.name}</strong>
                  <span>{formatMoney(price, settings.currency)}</span>
                </div>
                <span className="muted small">{court ? SPORT_LABELS[court.sport] : ''}</span>
                {/* The real calendar date: a 1 AM slot is on the next date, though it's listed under the operating day. */}
                <span className="small">
                  {formatDateLabel(todayInZone(tz, new Date(run.start)), tz)} · {formatHour(hourInZone(run.start, tz))}–{formatHour(hourInZone(end, tz))} ({hours(run.slots)})
                </span>
                {promos.length > 0 && <span className="selection-promo small">{`Promo: ${promos.join(', ')}`}</span>}
              </li>
            )
          })}
        </ul>
        <dl className="facts">
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
          <p>{groupBookingErrorMessage(create.error)}</p>
          {isSlotGone(create.error) && <Link to={gridLink}>Pick another time</Link>}
        </div>
      )}

      <CheckoutDetails settings={settings} pending={create.isPending} onSubmit={handleSubmit} />
    </div>
  )
}
