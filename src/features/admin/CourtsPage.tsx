import { Link } from 'react-router-dom'
import { PageLoader } from '../../components/PageLoader'
import { ErrorMessage } from '../../components/ErrorMessage'
import { useCourts, useVenueSettings } from '../catalog/hooks'
import { SPORT_LABELS } from '../catalog/api'
import { sportsOf } from '../catalog/sportOrder'
import { formatMoney } from '../../lib/format'
import { useReorderCourts } from './hooks'
import { SortableList } from './SortableList'

export function CourtsPage() {
  const courts = useCourts({ includeInactive: true })
  const currency = useVenueSettings().data?.currency
  const move = useReorderCourts()

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
        <div className="stack">
          <p className="muted small">
            Courts are listed in the order players see them. Change the order of sports in{' '}
            <Link to="/admin/settings">Settings</Link>.
          </p>
          {move.isError && <ErrorMessage error={move.error} />}
          {sportsOf(courts.data).map((sport) => {
            const group = courts.data.filter((c) => c.sport === sport)
            return (
              <section key={sport} aria-labelledby={`sport-${sport}`}>
                <h2 id={`sport-${sport}`} className="list-group-title">{SPORT_LABELS[sport]}</h2>
                <SortableList
                  className="list card flush"
                  label={`${SPORT_LABELS[sport]} courts`}
                  items={group.map((c) => ({ ...c, label: c.name }))}
                  onReorder={(ids) => move.mutate({ sport, ids })}
                  renderItem={(court) => (
                    <Link to={`/admin/courts/${court.id}`} className="list-row">
                      <strong>{court.name}</strong>
                      <span className="list-row-end">
                        <span>{formatMoney(court.default_hourly_rate, currency)}/hr</span>
                        {!court.is_active && <span className="badge">Archived</span>}
                      </span>
                    </Link>
                  )}
                />
              </section>
            )
          })}
        </div>
      )}
    </section>
  )
}
