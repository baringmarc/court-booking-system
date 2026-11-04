import type { VenueOverview } from './api'
import { useSetVenueShowcaseApproval, useShowcaseApprovals } from './hooks'

/** ConsoleGuard controls visibility; the approval RPC enforces platform authority. */
export function ShowcaseControl({ venue }: { venue: VenueOverview }) {
  const approvals = useShowcaseApprovals()
  const save = useSetVenueShowcaseApproval()
  const approval = approvals.data?.find((row) => row.id === venue.venue_id)

  if (approvals.isPending) return <p className="muted">Loading showcase…</p>
  if (approvals.isError || !approval) return <div className="stack">
    <p className="form-error" role="alert">Showcase approval unavailable.</p>
    <div><button type="button" className="btn btn-ghost" disabled={approvals.isFetching}
      onClick={() => void approvals.refetch()}>Retry showcase</button></div>
  </div>

  const approved = approval.showcase_approved
  return <div className="stack">
    <p aria-live="polite">Showcase: {approved ? 'Approved' : 'Not approved'}</p>
    <p className="muted small">
      {approved && venue.status === 'active'
        ? 'Eligible for the public showcase.'
        : 'Excluded from the public showcase. Only active, approved venues are listed.'}
    </p>
    <div className="form-actions">
      <button type="button" className="btn btn-ghost" disabled={save.isPending || approvals.isFetching}
        onClick={() => save.mutate({ venueId: venue.venue_id, approved: !approved })}>
        {approved ? 'Remove from showcase' : 'Approve showcase'}
      </button>
      {save.isPending && <span className="muted small" role="status">Saving showcase…</span>}
    </div>
    {save.error && <p className="form-error" role="alert">{save.error.message}</p>}
  </div>
}
