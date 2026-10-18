import { Link } from 'react-router-dom'
import { PageLoader } from '../components/PageLoader'
import { ErrorMessage } from '../components/ErrorMessage'
import { useCourts, useOperatingHours, useVenueSettings } from '../features/catalog/hooks'
import { SPORT_LABELS, SPORTS, type Court } from '../features/catalog/api'
import { summarizeHours } from '../features/catalog/hours'
import { CourtTiles } from '../features/catalog/CourtTiles'
import { HomeBanner } from '../features/catalog/HomeBanner'
import { formatMoney } from '../lib/format'

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

      <h2>Our courts</h2>
      {courts.isPending ? (
        <PageLoader />
      ) : courts.isError ? (
        <ErrorMessage error={courts.error} onRetry={() => courts.refetch()} />
      ) : courts.data.length === 0 ? (
        <p className="muted">No courts are open for booking right now.</p>
      ) : (
        <div className="stack">
          {SPORTS.map((sport) => {
            const list = courts.data.filter((c) => c.sport === sport)
            if (list.length === 0) return null
            return <SportGroup key={sport} title={SPORT_LABELS[sport]} courts={list} currency={currency} />
          })}
        </div>
      )}
    </section>
  )
}

function SportGroup({ title, courts, currency }: { title: string; courts: Court[]; currency: string }) {
  const minRate = Math.min(...courts.map((c) => c.default_hourly_rate))
  return (
    <section className="card">
      <div className="sport-head">
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
