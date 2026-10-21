import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { ApiError } from '../../lib/queryClient'
import type { Court } from '../catalog/api'
import { useDeleteCourt } from './hooks'

/** Delete a court that was never booked (T9.5). A booked court can only be archived, so its history stays. */
export function DeleteCourtSection({ court }: { court: Pick<Court, 'id' | 'name' | 'is_active'> }) {
  const navigate = useNavigate()
  const remove = useDeleteCourt(court.id)
  const [confirming, setConfirming] = useState(false)
  const hasBookings = remove.error instanceof ApiError && remove.error.hint === 'court_has_bookings'

  function confirm() {
    remove.mutate(undefined, { onSuccess: () => navigate('/admin/courts', { replace: true }) })
  }

  return (
    <section className="card stack" aria-labelledby="delete-court-heading">
      <h2 id="delete-court-heading">Delete court</h2>
      <p className="muted small">
        Only a court that was never booked can be deleted. Its rates and photos go with it. A court with bookings
        can be archived instead: uncheck “Active” in Details.
      </p>
      {remove.error != null && (
        <div className="stack">
          <ErrorMessage error={remove.error} />
          {hasBookings && court.is_active && (
            <p className="small">To hide it from players, uncheck “Active” in Details above and save.</p>
          )}
        </div>
      )}
      {confirming ? (
        <div className="form-actions">
          <button type="button" className="btn btn-danger" disabled={remove.isPending} onClick={confirm}>
            {remove.isPending ? 'Deleting…' : `Yes, delete ${court.name}`}
          </button>
          <button type="button" className="btn btn-ghost" disabled={remove.isPending} onClick={() => setConfirming(false)}>
            Keep court
          </button>
        </div>
      ) : (
        <div className="form-actions">
          <button type="button" className="btn btn-outline" onClick={() => { remove.reset(); setConfirming(true) }}>
            Delete court
          </button>
        </div>
      )}
    </section>
  )
}
