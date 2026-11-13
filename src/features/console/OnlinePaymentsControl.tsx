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

  if (switches.isPending) return <div className="setting-row"><p className="muted">Loading online payments…</p></div>
  if (switches.isError || !row) return <div className="setting-row">
    <p className="form-error setting-wide" role="alert">Online payments unavailable.</p>
    <div className="setting-action"><button type="button" className="btn btn-outline btn-small" disabled={switches.isFetching}
      onClick={() => void switches.refetch()}>Retry online payments</button></div>
  </div>

  const enabled = row.online_payments_enabled
  const closeDialog = () => {
    setConfirming(false)
    opener.current?.focus()
  }
  return <div className="setting-row" data-state={enabled ? 'on' : 'off'}>
    <div className="setting-text">
      <p className="setting-state" aria-live="polite">{`Online payments: ${enabled ? 'On' : 'Off'}`}</p>
      <p className="muted small">Players can pay with PayMongo (test mode) as well as manually.</p>
    </div>
    <div className="setting-action">
      <button ref={opener} type="button" className="btn btn-outline btn-small" disabled={save.isPending || switches.isFetching}
        onClick={() => {
          if (enabled) save.mutate({ venueId: venue.venue_id, enabled: false })
          else setConfirming(true)
        }}>
        {enabled ? 'Turn off online payments' : 'Turn on online payments'}
      </button>
      {save.isPending && <span className="muted small" role="status">Saving online payments…</span>}
    </div>
    {save.error && <p className="form-error setting-wide" role="alert">{save.error.message}</p>}
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
