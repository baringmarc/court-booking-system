import { Link } from 'react-router-dom'
import { PageLoader } from '../../components/PageLoader'
import { ErrorMessage } from '../../components/ErrorMessage'
import { useCourts, useVenueSettings } from '../catalog/hooks'
import { SPORT_LABELS } from '../catalog/api'
import { formatMoney } from '../../lib/format'

export function CourtsPage() {
  const courts = useCourts({ includeInactive: true })
  const currency = useVenueSettings().data?.currency

  return (
    <section className="page">
      <div className="page-head">
        <h1>Courts & rates</h1>
        <Link to="/admin/courts/new" className="btn">Add court</Link>
      </div>

      {courts.isPending ? (
        <PageLoader />
      ) : courts.isError ? (
        <ErrorMessage error={courts.error} onRetry={() => courts.refetch()} />
      ) : courts.data.length === 0 ? (
        <p className="muted">No courts yet. Add your first court to start taking bookings.</p>
      ) : (
        <ul className="list card flush">
          {courts.data.map((court) => (
            <li key={court.id}>
              <Link to={`/admin/courts/${court.id}`} className="list-row">
                <span>
                  <strong>{court.name}</strong>
                  <span className="muted small block">{SPORT_LABELS[court.sport]}</span>
                </span>
                <span className="list-row-end">
                  <span>{formatMoney(court.default_hourly_rate, currency)}/hr</span>
                  {!court.is_active && <span className="badge">Archived</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
