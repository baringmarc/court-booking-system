import type { VenueOverview } from './api'
import { useSetWalkIns, useWalkIns } from './hooks'

/** T18.4: ConsoleGuard controls visibility; set_walk_ins enforces platform authority. No confirmation either way. */
export function WalkInsControl({ venue }: { venue: VenueOverview }) {
  const switches = useWalkIns()
  const save = useSetWalkIns()
  const row = switches.data?.find((item) => item.venue_id === venue.venue_id)

  if (switches.isPending) return <p className="muted">Loading walk-ins…</p>
  if (switches.isError || !row) return <div className="stack">
    <p className="form-error" role="alert">Walk-ins unavailable.</p>
    <div><button type="button" className="btn btn-ghost" disabled={switches.isFetching}
      onClick={() => void switches.refetch()}>Retry walk-ins</button></div>
  </div>

  const enabled = row.walk_ins_enabled
  return <div className="stack">
    <p aria-live="polite">{`Walk-ins: ${enabled ? 'On' : 'Off'}`}</p>
    <div className="form-actions">
      <button type="button" className="btn btn-ghost" disabled={save.isPending || switches.isFetching}
        onClick={() => save.mutate({ venueId: venue.venue_id, enabled: !enabled })}>
        {enabled ? 'Turn off walk-ins' : 'Turn on walk-ins'}
      </button>
      {save.isPending && <span className="muted small" role="status">Saving walk-ins…</span>}
    </div>
    {save.error && <p className="form-error" role="alert">{save.error.message}</p>}
  </div>
}
