import { useRef, useState } from 'react'
import type { VenueOverview } from './api'
import { ConsoleDialog } from './ConsoleDialog'
import { useOnlinePayments, useSetOnlinePayments } from './hooks'

/** T18.2: ConsoleGuard controls visibility; set_online_payments enforces platform authority. */
export function OnlinePaymentsControl({ venue }: { venue: VenueOverview }) {
  const switches = useOnlinePayments()
  const save = useSetOnlinePayments()
  const [confirming, setConfirming] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const row = switches.data?.find((item) => item.venue_id === venue.venue_id)

  if (switches.isPending) return <p className="muted">Loading online payments…</p>
  if (switches.isError || !row) return <div className="stack">
    <p className="form-error" role="alert">Online payments unavailable.</p>
    <div><button type="button" className="btn btn-ghost" disabled={switches.isFetching}
      onClick={() => void switches.refetch()}>Retry online payments</button></div>
  </div>

  const enabled = row.online_payments_enabled
  const closeDialog = () => {
    setConfirming(false)
    opener.current?.focus()
  }
  return <div className="stack">
    <p aria-live="polite">{`Online payments: ${enabled ? 'On' : 'Off'}`}</p>
    <div className="form-actions">
      <button ref={opener} type="button" className="btn btn-ghost" disabled={save.isPending || switches.isFetching}
        onClick={() => {
          if (enabled) save.mutate({ venueId: venue.venue_id, enabled: false })
          else setConfirming(true)
        }}>
        {enabled ? 'Turn off online payments' : 'Turn on online payments'}
      </button>
      {save.isPending && <span className="muted small" role="status">Saving online payments…</span>}
    </div>
    {save.error && <p className="form-error" role="alert">{save.error.message}</p>}
    {confirming && (
      <ConsoleDialog id="online-payments" title="Turn on online payments?" onCancel={closeDialog}>
        <p>Players at {venue.name} will see “Pay online with PayMongo”. Until venues have their own PayMongo accounts,
          these payments go through Plotline's PayMongo test-mode account, so use this for demos and testing only.</p>
        <div className="form-actions">
          <button type="button" className="btn btn-outline" autoFocus onClick={closeDialog}>Cancel</button>
          <button type="button" className="btn" onClick={() => {
            save.mutate({ venueId: venue.venue_id, enabled: true })
            closeDialog()
          }}>Turn on</button>
        </div>
      </ConsoleDialog>
    )}
  </div>
}
