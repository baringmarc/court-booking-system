import { Link } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import type { SetupItem } from './api'
import { usePublishVenue, useSetupStatus } from './hooks'

/** Where each missing item is fixed. */
const FIX_LINKS: Record<string, string> = {
  courts: '/admin/courts',
  rates: '/admin/courts',
  hours: '/admin/schedule?tab=hours',
  payment: '/admin/settings/payments',
  payment_instructions: '/admin/settings/payments',
  photos: '/admin/courts',
}

/** Where each item is fixed, in the owner's words (T17.34). The labels themselves come from the RPC. */
const FIX_PLACES: Record<string, string> = {
  courts: 'Courts page',
  rates: 'Courts page',
  hours: 'Schedule → Opening hours',
  payment: 'Settings → Payments',
  payment_instructions: 'Settings → Payments',
  photos: 'Courts page',
}

/** The setup checklist of a draft venue, with the button that publishes it (T14.7). */
export function SetupChecklist() {
  const status = useSetupStatus()
  const publish = usePublishVenue()

  return (
    <section className="card stack" aria-labelledby="setup-heading">
      {status.isPending ? <PageLoader /> : status.isError ? (
        <ErrorMessage error={status.error} onRetry={() => status.refetch()} />
      ) : (
        <>
          <div className="setup-head">
            <h2 id="setup-heading">Set up your venue</h2>
            <span className="badge">{requiredDone(status.data.items)}</span>
          </div>
          <p className="muted">Players can't book until the venue is published.</p>
          <ul className="list">
            {status.data.items.map((item) => (
              <li key={item.key} className={`list-row setup-row${item.done ? ' setup-done' : ''}`}>
                <span className="setup-icon" aria-hidden="true">{item.done ? '✓' : '○'}</span>
                <span className="setup-text">
                  <span className="sr-only">{item.done ? 'Done' : 'To do'}</span>
                  <span>{item.label}</span>
                  {!item.done && FIX_PLACES[item.key] && <span className="block small muted">{FIX_PLACES[item.key]}</span>}
                </span>
                <span className="list-row-end">
                  {!item.required && <span className="badge">Optional</span>}
                  {!item.done && FIX_LINKS[item.key] && <Link className="btn btn-outline btn-small" to={FIX_LINKS[item.key]}>Fix</Link>}
                </span>
              </li>
            ))}
          </ul>
          {publish.isError && <ErrorMessage error={publish.error} />}
          <button type="button" className="btn" disabled={!status.data.ready || publish.isPending}
            onClick={() => publish.mutate()}>
            {publish.isPending ? 'Publishing…' : 'Publish venue'}
          </button>
        </>
      )}
    </section>
  )
}

/** "2 of 5 done": the required items done, out of all required ones. */
function requiredDone(items: SetupItem[]): string {
  const required = items.filter((i) => i.required)
  return `${required.filter((i) => i.done).length} of ${required.length} done`
}
