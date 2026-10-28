import { Link } from 'react-router-dom'
import { PageLoader } from '../components/PageLoader'
import { ErrorMessage } from '../components/ErrorMessage'
import { useCourts, useOperatingHours, useVenueSettings } from '../features/catalog/hooks'
import { SPORT_LABELS, type CourtWithPhotos } from '../features/catalog/api'
import { sportsOf } from '../features/catalog/sportOrder'
import { summarizeHours } from '../features/catalog/hours'
import { CourtTiles } from '../features/catalog/CourtTiles'
import { HomeBanner } from '../features/catalog/HomeBanner'
import { formatMoney } from '../lib/format'
import { AmenityChips, InfoSections, VenueLocation } from '../features/venue/VenueInfo'

export function HomePage() {
  const settings = useVenueSettings()
  const courts = useCourts()
  const hours = useOperatingHours()

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
        <p className="lead">
          Pick a court and a time, then pay with GCash, Maya or a bank transfer.
        </p>
        {hours.data && (
          <ul className="hours-summary">
            {summarizeHours(hours.data).map((line) => <li key={line}>{line}</li>)}
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

      {settings.data && (
        <VenueLocation address={settings.data.address} mapsUrl={settings.data.maps_url} />
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
