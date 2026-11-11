import { Link } from 'react-router-dom'
import { PageLoader } from '../components/PageLoader'
import { ErrorMessage } from '../components/ErrorMessage'
import { useCourts, usePublicSchedule, useVenueSettings } from '../features/catalog/hooks'
import { SPORT_LABELS, type CourtWithPhotos, type Sport } from '../features/catalog/api'
import { sportsOf } from '../features/catalog/sportOrder'
import { CourtTiles } from '../features/catalog/CourtTiles'
import { HomeBanner } from '../features/catalog/HomeBanner'
import { summarizeSchedule } from '../features/catalog/hours'
import { formatMoney } from '../lib/format'
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
        {/* The summary needs the court names too; a courts error shows under "Our courts". */}
        {(hours.isPending || (hours.isSuccess && hours.data.length > 0 && courts.isPending)) && <p className="muted">Loading court hours…</p>}
        {hours.isError && <ErrorMessage error={hours.error} onRetry={() => hours.refetch()} />}
        {hours.isSuccess && hours.data.length === 0 && <p className="muted">No upcoming court hours.</p>}
        {hours.isSuccess && hours.data.length > 0 && courts.isSuccess && (
          <ul className="hours-summary" aria-label="Upcoming court hours">
            {summarizeSchedule(hours.data, courts.data,settings.data?.timezone ?? 'Asia/Manila').map((line) => <li key={line}>{line}</li>)}
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
            <SportGroup key={sport} sport={sport} courts={courts.data.filter((c) => c.sport === sport)} currency={currency} />
          ))}
        </div>
      )}

      <InfoSections />
    </section>
  )
}

/** T22.1: the whole card is one link to /book on this sport's tab. The aria-label keeps its name short, so a screen reader hears one link, not the card's text. */
function SportGroup({ sport, courts, currency }: { sport: Sport; courts: CourtWithPhotos[]; currency: string }) {
  const title = SPORT_LABELS[sport]
  const minRate = Math.min(...courts.map((c) => c.default_hourly_rate))
  return (
    <section className="card sport-card">
      <Link to={`/book?sport=${sport}`} className="sport-card-link" aria-label={`Book ${title.toLowerCase()} courts`}>
        <div className="sport-head card-head">
          <h3>{title}</h3>
          <span className="muted">
            {courts.length} {courts.length === 1 ? 'court' : 'courts'} · from {formatMoney(minRate, currency)}/hr
          </span>
        </div>
        <p className="muted small">{courts[0].description}</p>
        <CourtTiles courts={courts} />
      </Link>
    </section>
  )
}
