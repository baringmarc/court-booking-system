import { useState, type FormEvent } from 'react'
import { formatMoney } from '../../lib/format'
import type { VenueOverview } from './api'
import { useReactivateVenue, useResendOwnerInvite, useSuspendVenue, useVenuesOverview } from './hooks'

/** Re-sends the owner a way in: the first invite can be used up, expired or never delivered (T14.5d). */
function ResendInvite({ venue }: { venue: VenueOverview }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const resend = useResendOwnerInvite()

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    resend.mutate({ venueId: venue.venue_id, email })
  }

  if (!open) {
    return <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>Resend invite</button>
  }
  const sent = resend.data?.sent
  return (
    <form className="stack" onSubmit={handleSubmit}>
      <label className="field">
        <span>Owner email</span>
        <input type="email" autoComplete="off" required value={email} onChange={(e) => { setEmail(e.target.value); resend.reset() }} />
      </label>
      <button type="submit" className="btn" disabled={resend.isPending}>Send invite</button>
      {sent === 'none' && (
        <p role="status">{email} already has a password. They can sign in at {venue.slug}.plotline.fit/admin/login.</p>
      )}
      {(sent === 'invite' || sent === 'link') && <p role="status">A {sent === 'invite' ? 'new invite' : 'sign-in link'} is on its way to {email}.</p>}
      {resend.error && <p className="form-error" role="alert">{resend.error.message}</p>}
    </form>
  )
}

function VenueItem({ venue }: { venue: VenueOverview }) {
  const suspend = useSuspendVenue()
  const reactivate = useReactivateVenue()
  const error = suspend.error ?? reactivate.error
  return (
    <li className="card stack">
      <strong>{venue.name}</strong>
      <p className="muted">{venue.slug} · {venue.status}</p>
      <p>{venue.month_transactions} transactions · {formatMoney(venue.month_total)} this month</p>
      <p className="muted">{venue.open_invoices} open {venue.open_invoices === 1 ? 'invoice' : 'invoices'}</p>
      <div className="form-actions"><ResendInvite venue={venue} /></div>
      {venue.status === 'active' && (
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={suspend.isPending}
            onClick={() => {
              if (window.confirm(`Suspend ${venue.name}? Players will no longer be able to book.`)) suspend.mutate(venue.venue_id)
            }}
          >
            Suspend
          </button>
        </div>
      )}
      {venue.status === 'suspended' && (
        <div className="form-actions">
          <button type="button" className="btn" disabled={reactivate.isPending} onClick={() => reactivate.mutate(venue.venue_id)}>
            Reactivate
          </button>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error.message}</p>}
    </li>
  )
}

/** The console's venues list (T14.8): status, this month's transactions and total, open invoices, suspend and reactivate. */
export function VenuesList() {
  const venues = useVenuesOverview()
  return (
    <section className="stack" aria-labelledby="venues-heading">
      <h2 id="venues-heading">Venues</h2>
      {venues.isPending ? (
        <p className="muted">Loading venues…</p>
      ) : venues.error ? (
        <div className="alert alert-error">
          <p>Couldn't load venues.</p>
          <button type="button" className="btn btn-ghost" onClick={() => void venues.refetch()}>Retry</button>
        </div>
      ) : venues.data.length === 0 ? (
        <p className="muted">No venues yet.</p>
      ) : (
        <ul className="list">
          {venues.data.map((v) => <VenueItem key={v.venue_id} venue={v} />)}
        </ul>
      )}
    </section>
  )
}
