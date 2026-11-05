import { Link } from 'react-router-dom'
import { PageLoader } from '../components/PageLoader'
import { ErrorMessage } from '../components/ErrorMessage'
import { useCourts, usePublicSchedule, useVenueSettings } from '../features/catalog/hooks'
import { SPORT_LABELS, type CourtWithPhotos } from '../features/catalog/api'
import { sportsOf } from '../features/catalog/sportOrder'
import { CourtTiles } from '../features/catalog/CourtTiles'
import { HomeBanner } from '../features/catalog/HomeBanner'
import { formatHour, formatMoney } from '../lib/format'
import { addDays, formatDateLabel, hourInZone, todayInZone } from '../lib/time'
import { AmenityChips, InfoSections, QuickFacts, VenueAddress } from '../features/venue/VenueInfo'

export function HomePage() {
  const settings = useVenueSettings()
  const courts = useCourts()
  const hours = usePublicSchedule()

  const venueName = settings.data?.name ?? 'Claudex Courts'
  const currency = settings.data?.currency ?? 'PHP'

  return (
    <section className="page">
      <HomeBanner />
      <div className="hero">
        <div className="hero-shapes" aria-hidden="true">
          <span className="shape-ring" /><span className="shape-dot" /><span className="shape-leaf" />
        </div>
        <h1>Book a court at {venueName}</h1>
        {/* T11.24: where the venue is and what it offers, right under its name (the Location card is gone from /). */}
        {settings.data && <VenueAddress address={settings.data.address} mapsUrl={settings.data.maps_url} />}
        <QuickFacts courtCount={courts.isSuccess ? courts.data.length : undefined} slotMinutes={settings.data?.slot_minutes} />
        <p className="lead">
          {settings.data?.online_payments_enabled
            ? 'Pick a court and a time, then pay online with a card, GCash or Maya, or by bank transfer.'
            : 'Pick a court and a time, then pay with GCash, Maya or a bank transfer.'}
        </p>
        {hours.isPending && <p className="muted">Loading court hours…</p>}
        {hours.isError && <ErrorMessage error={hours.error} onRetry={() => hours.refetch()} />}
        {hours.isSuccess && hours.data.length === 0 && <p className="muted">No upcoming court hours.</p>}
        {hours.data && hours.data.length > 0 && (
          <ul className="hours-summary" aria-label="Upcoming court hours">
            {[...hours.data].sort((a, b) => a.period_start.localeCompare(b.period_start)).filter((period) => period.operating_date < addDays(hours.data.map((item) => item.operating_date).sort()[0], 7))
              .map((period) => <li key={`${period.court_id}-${period.period_start}`}>
                {courts.data?.find((court) => court.id === period.court_id)?.name}: {formatDateLabel(period.operating_date, settings.data?.timezone ?? 'Asia/Manila')} · {formatHour(hourInZone(period.period_start, settings.data?.timezone ?? 'Asia/Manila'))}–{formatHour(hourInZone(period.period_end, settings.data?.timezone ?? 'Asia/Manila'))}{todayInZone(settings.data?.timezone ?? 'Asia/Manila', new Date(period.period_end)) !== period.operating_date ? ' (next day)' : ''}
              </li>)}
          </ul>
        )}
        <div className="hero-actions">
          <Link to="/book" className="btn">Book now</Link>
        </div>
      </div>

      <AmenityChips />

      <h2>Our courts</h2>
      {courts.isPending ? (
        <PageLoader />
      ) : courts.isError ? (
        <ErrorMessage error={courts.error} onRetry={() => courts.refetch()} />
      ) : courts.data.length === 0 ? (
        <p className="muted">No courts are open for booking right now.</p>
      ) : (
        <div className="stack">
          {/* Courts arrive in the venue's sport order (fetchCourts), so group them in that order. */}
          {sportsOf(courts.data).map((sport) => (
            <SportGroup key={sport} title={SPORT_LABELS[sport]} courts={courts.data.filter((c) => c.sport === sport)} currency={currency} />
          ))}
        </div>
      )}

      <InfoSections />
    </section>
  )
}

function SportGroup({ title, courts, currency }: { title: string; courts: CourtWithPhotos[]; currency: string }) {
  const minRate = Math.min(...courts.map((c) => c.default_hourly_rate))
  return (
    <section className="card">
      <div className="sport-head card-head">
        <h3>{title}</h3>
        <span className="muted">
          {courts.length} {courts.length === 1 ? 'court' : 'courts'} · from {formatMoney(minRate, currency)}/hr
        </span>
      </div>
      <p className="muted small">{courts[0].description}</p>
      <CourtTiles courts={courts} />
    </section>
  )
}
