import { Link } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { usePublishVenue, useSetupStatus } from './hooks'

/** Where each missing item is fixed. */
const FIX_LINKS: Record<string, string> = {
  courts: '/admin/courts',
  rates: '/admin/courts',
  hours: '/admin/settings',
  payment: '/admin/settings/payments',
  payment_instructions: '/admin/settings/payments',
  photos: '/admin/courts',
}

const FIX_REASONS: Record<string, string> = {
  courts: 'Add at least one active court.',
  rates: 'Set a price above 0 for every active court.',
  hours: 'Set opening hours for at least one day.',
  payment: 'Add a payment account with an account name and number.',
  payment_instructions: 'Add the payment instructions players should follow.',
  photos: 'Add photos to help players recognize your courts.',
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
          <h2 id="setup-heading">Set up your venue</h2>
          <p className="muted">Players can't book until the venue is published.</p>
          <ul className="list">
            {status.data.items.map((item) => (
              <li key={item.key} className="list-row">
                <span className="stack-sm"><span>{item.label}</span>{!item.done && FIX_REASONS[item.key] && <span className="muted small">{FIX_REASONS[item.key]}</span>}</span>
                <span>
                  {!item.required && <span className="badge">Optional</span>}{' '}
                  <span className={`badge ${item.done ? 'status-confirmed' : ''}`}>{item.done ? 'Done' : 'To do'}</span>
                  {!item.done && FIX_LINKS[item.key] && <>{' '}<Link to={FIX_LINKS[item.key]}>Fix</Link></>}
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
