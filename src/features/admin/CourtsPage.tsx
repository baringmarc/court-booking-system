import { Link } from 'react-router-dom'
import { PageLoader } from '../../components/PageLoader'
import { ErrorMessage } from '../../components/ErrorMessage'
import { useCourts, useVenueSettings } from '../catalog/hooks'
import { SPORT_LABELS, type Court } from '../catalog/api'
import { sportsOf } from '../catalog/sportOrder'
import { formatMoney } from '../../lib/format'
import { useReorderCourts } from './hooks'
import { SortableList } from './SortableList'

/** "4 active · 1 archived", or "4 active" when nothing is archived. */
function courtCount(courts: Court[]) {
  const archived = courts.filter((c) => !c.is_active).length
  const active = courts.length - archived
  return archived > 0 ? `${active} active · ${archived} archived` : `${active} active`
}

export function CourtsPage() {
  const courts = useCourts({ includeInactive: true })
  const currency = useVenueSettings().data?.currency
  const move = useReorderCourts()

  return (
    <section className="page">
      <div className="page-head">
        <h1>Courts</h1>
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
          <p className="court-count">{courtCount(courts.data)}</p>
          <p className="muted small">
            Courts are listed in the order players see them. Change the order of sports in{' '}
            <Link to="/admin/settings">Settings</Link>.
          </p>
          {move.isError && <ErrorMessage error={move.error} />}
          {sportsOf(courts.data).map((sport) => {
            const active = courts.data.filter((c) => c.sport === sport && c.is_active)
            const archived = courts.data.filter((c) => c.sport === sport && !c.is_active)
            const row = (court: Court) => (
              <Link to={`/admin/courts/${court.id}`} className="list-row">
                <strong>{court.name}</strong>
                <span className="list-row-end">
                  <span>{formatMoney(court.default_hourly_rate, currency)}/hr</span>
                  <span className={court.is_active ? 'badge badge-active' : 'badge'}>{court.is_active ? 'Active' : 'Archived'}</span>
                </span>
              </Link>
            )
            return (
              <section key={sport} aria-labelledby={`sport-${sport}`}>
                <h2 id={`sport-${sport}`} className="list-group-title">{SPORT_LABELS[sport]}</h2>
                {active.length > 0 && (
                  <SortableList
                    className="list card flush"
                    label={`${SPORT_LABELS[sport]} courts`}
                    items={active.map((c) => ({ ...c, label: c.name }))}
                    // reorder_courts stores every court of the sport, so the archived ones keep their place after these.
                    onReorder={(ids) => move.mutate({ sport, ids: [...ids, ...archived.map((c) => c.id)] })}
                    renderItem={row}
                  />
                )}
                {archived.length > 0 && (
                  <ul className="list card flush archived-list" aria-label={`Archived ${SPORT_LABELS[sport]} courts`}>
                    {archived.map((c) => <li key={c.id} className="is-archived">{row(c)}</li>)}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </section>
  )
}
