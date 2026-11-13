import type { VenueOverview } from './api'
import { useSetVenueShowcaseApproval, useShowcaseApprovals } from './hooks'

/** ConsoleGuard controls visibility; the approval RPC enforces platform authority. */
export function ShowcaseControl({ venue }: { venue: VenueOverview }) {
  const approvals = useShowcaseApprovals()
  const save = useSetVenueShowcaseApproval()
  const approval = approvals.data?.find((row) => row.id === venue.venue_id)

  if (approvals.isPending) return <div className="setting-row"><p className="muted">Loading showcase…</p></div>
  if (approvals.isError || !approval) return <div className="setting-row">
    <p className="form-error setting-wide" role="alert">Showcase approval unavailable.</p>
    <div className="setting-action"><button type="button" className="btn btn-outline btn-small" disabled={approvals.isFetching}
      onClick={() => void approvals.refetch()}>Retry showcase</button></div>
  </div>

  const approved = approval.showcase_approved
  return <div className="setting-row" data-state={approved ? 'on' : 'off'}>
    <div className="setting-text">
      <p className="setting-state" aria-live="polite">Showcase: {approved ? 'Approved' : 'Not approved'}</p>
      <p className="muted small">
        {approved && venue.status === 'active'
          ? 'Eligible for the public showcase.'
          : 'Excluded from the public showcase. Only active, approved venues are listed.'}
      </p>
    </div>
    <div className="setting-action">
      <button type="button" className="btn btn-outline btn-small" disabled={save.isPending || approvals.isFetching}
        onClick={() => save.mutate({ venueId: venue.venue_id, approved: !approved })}>
        {approved ? 'Remove from showcase' : 'Approve showcase'}
      </button>
      {save.isPending && <span className="muted small" role="status">Saving showcase…</span>}
    </div>
    {save.error && <p className="form-error setting-wide" role="alert">{save.error.message}</p>}
  </div>
}
