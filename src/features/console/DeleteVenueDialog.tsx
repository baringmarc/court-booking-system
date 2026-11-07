import { useState } from 'react'
import { ConsoleDialog } from './ConsoleDialog'
import type { VenueDeletionBlocker, VenueDeletionPreview, VenueOverview } from './api'
import { useDeleteUnusedVenue, useRetryVenueFileCleanup, useVenueDeletionPreview } from './hooks'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const HISTORY: Record<Exclude<VenueDeletionBlocker, 'protected'>, (c: VenueDeletionPreview['counts']) => string> = {
  bookings: (c) => plural(c.bookings, 'booking'),
  payments: (c) => plural(c.payments, 'payment'),
  checkouts: (c) => plural(c.checkouts, 'online checkout'),
  charges: (c) => plural(c.charges, 'billing charge'),
  invoices: (c) => plural(c.invoices, 'invoice'),
  open_play: (c) => plural(c.open_play_sessions, 'open play session'),
}

function Blocked({ preview, onCancel }: { preview: VenueDeletionPreview; onCancel: () => void }) {
  const history = preview.blockers.filter((b): b is Exclude<VenueDeletionBlocker, 'protected'> => b !== 'protected')
  return (
    <>
      {preview.blockers.includes('protected') && <p>This is a protected venue (the demo) and can never be deleted.</p>}
      {history.length > 0 && (
        <p>It can't be deleted because it has booking or billing history: {history.map((b) => HISTORY[b](preview.counts)).join(', ')}.</p>
      )}
      <p className="muted">Test records of a venue that was used are removed only through the separately reviewed test-data cleanup, never from the console.</p>
      <div className="form-actions">
        <button type="button" className="btn btn-outline" autoFocus onClick={onCancel}>Close</button>
      </div>
    </>
  )
}

/**
 * Deletes a venue that never had history (T17.28): the server preview, the typed subdomain, then the
 * delete-unused-venue function. The venue counts as deleted only once its files are confirmed removed; until then
 * the dialog stays open with Retry cleanup. Rendered by the page, not the panel, since the deleted row leaves the list.
 */
export function DeleteVenueDialog({ venue, onCancel, onDeleted, onClosePending }: {
  venue: VenueOverview; onCancel: () => void; onDeleted: () => void; onClosePending: () => void
}) {
  const [typed, setTyped] = useState('')
  const remove = useDeleteUnusedVenue()
  const retry = useRetryVenueFileCleanup()
  const deleted = remove.isSuccess
  const preview = useVenueDeletionPreview(venue.venue_id, !deleted)
  const title = `Delete ${venue.name}?`

  if (deleted) {
    const error = retry.error
    return (
      <ConsoleDialog id="delete-venue" title={title} onCancel={onClosePending}>
        <p role="status">{venue.name} was deleted, but file cleanup is pending: some of its files are not confirmed removed yet.</p>
        {error && <p className="form-error" role="alert">{error.message}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-outline" onClick={onClosePending}>Close</button>
          <button type="button" className="btn" autoFocus disabled={retry.isPending} onClick={() => retry.mutate(venue.venue_id, {
            onSuccess: (out) => { if (out.cleanup === 'done') onDeleted() },
          })}>
            Retry cleanup
          </button>
        </div>
      </ConsoleDialog>
    )
  }

  return (
    <ConsoleDialog id="delete-venue" title={title} onCancel={onCancel}>
      {preview.isPending && (
        <>
          <p className="muted">Checking what this venue has…</p>
          <div className="form-actions"><button type="button" className="btn btn-outline" autoFocus onClick={onCancel}>Cancel</button></div>
        </>
      )}
      {preview.error && (
        <>
          <p className="form-error" role="alert">Couldn't load what this venue has: {preview.error.message}</p>
          <div className="form-actions"><button type="button" className="btn btn-outline" autoFocus onClick={onCancel}>Cancel</button></div>
        </>
      )}
      {preview.data && !preview.data.deletable && <Blocked preview={preview.data} onCancel={onCancel} />}
      {preview.data?.deletable && (
        <form className="stack" onSubmit={(e) => {
          e.preventDefault()
          if (typed === preview.data.slug) remove.mutate({ venueId: venue.venue_id, confirmSlug: typed }, {
            onSuccess: (out) => { if (out.cleanup === 'done') onDeleted() },
          })
        }}>
          <p>Subdomain: <strong>{preview.data.slug}</strong></p>
          <p>This removes its settings, schedule and prices, {plural(preview.data.counts.courts, 'court')} and {plural(preview.data.counts.members, 'member')} (their access to this venue), and its uploaded files.</p>
          <p className="muted">Owner and staff accounts are kept and can still sign in to their other venues.</p>
          <label className="field">
            <span>Type the subdomain to confirm</span>
            <input type="text" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => { setTyped(e.target.value); remove.reset() }} />
          </label>
          {remove.error && <p className="form-error" role="alert">{remove.error.message}</p>}
          <div className="form-actions">
            <button type="button" className="btn btn-outline" autoFocus onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn-danger" disabled={typed !== preview.data.slug || remove.isPending}>Delete venue</button>
          </div>
        </form>
      )}
    </ConsoleDialog>
  )
}
