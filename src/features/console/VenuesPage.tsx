import { useState, type FormEvent } from 'react'
import { formatMoney } from '../../lib/format'
import type { VenueOverview } from './api'
import { useReactivateVenue, useResendOwnerInvite, useSuspendVenue, useVenuesPage } from './hooks'
import { DetailsButton, ListStatus, RecordPanel, SearchField, StatusFilter } from './ListControls'
import { focusDetails, useListParams } from './listParams'
import { Pager } from './Pager'
import { ShowcaseControl } from './ShowcaseControl'

const VENUE_STATUSES = ['active', 'draft', 'suspended'] as const
const FILTER_OPTIONS = [['', 'All'], ['active', 'Active'], ['draft', 'Draft'], ['suspended', 'Suspended']] as const

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

function VenuePanel({ venue, onClose }: { venue: VenueOverview; onClose: () => void }) {
  const suspend = useSuspendVenue()
  const reactivate = useReactivateVenue()
  const error = suspend.error ?? reactivate.error
  return (
    <RecordPanel label={`Venue: ${venue.name}`} title={venue.name} onClose={onClose}>
      <p className="muted">{venue.slug} · {venue.status}</p>
      <p>{venue.month_transactions} transactions · {formatMoney(venue.month_total)} this month</p>
      <p className="muted">{venue.open_invoices} open {venue.open_invoices === 1 ? 'invoice' : 'invoices'}</p>
      <ShowcaseControl venue={venue} />
      <div className="form-actions"><ResendInvite venue={venue} /></div>
      {venue.status === 'active' && (
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" disabled={suspend.isPending} onClick={() => {
            if (window.confirm(`Suspend ${venue.name}? Players will no longer be able to book.`)) suspend.mutate(venue.venue_id)
          }}>
            Suspend
          </button>
        </div>
      )}
      {venue.status === 'suspended' && (
        <div className="form-actions">
          <button type="button" className="btn" disabled={reactivate.isPending} onClick={() => reactivate.mutate(venue.venue_id)}>Reactivate</button>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error.message}</p>}
    </RecordPanel>
  )
}

/** The console's Venues page (T14.8, routed and paged in T17.19): status, month totals and actions in each venue's panel. */
export function VenuesPage() {
  const { state, setFilter, setPage, setOpen } = useListParams(VENUE_STATUSES)
  const venues = useVenuesPage({ search: state.q, status: state.status, page: state.page })
  const rows = venues.data?.rows ?? []
  const open = rows.find((venue) => venue.venue_id === state.open)
  const filtered = state.status !== '' || state.q !== ''

  return (
    <div className="stack console-page">
      <h1>Venues</h1>
      <div className="console-filters">
        <SearchField id="venue-search" label="Search venues" value={state.q} onSearch={(q) => setFilter({ q })} />
        <StatusFilter id="venue-filter" value={state.status} options={FILTER_OPTIONS} onChange={(status) => setFilter({ status })} />
      </div>
      <ListStatus noun="venues" pending={venues.isPending} error={venues.error} onRetry={() => void venues.refetch()}
        empty={venues.isSuccess && venues.data.total === 0} filtered={filtered ? 'No venues match these filters.' : 'No venues yet.'} />
      {venues.data && venues.data.total > 0 && (
        <div className={`console-records${open ? ' has-panel' : ''}`}>
          <div className="stack">
            <ul className="list console-rows">
              {rows.map((venue) => (
                <li key={venue.venue_id} className="card console-row">
                  <div className="console-row-main">
                    <strong>{venue.name}</strong>
                    <span className="muted small">{venue.slug}</span>
                  </div>
                  <span className="badge">{venue.status}</span>
                  <DetailsButton id={venue.venue_id} name={venue.name} onOpen={() => setOpen(venue.venue_id)} />
                </li>
              ))}
            </ul>
            <Pager label="Venues pages" page={state.page} total={venues.data.total} onPage={setPage} />
          </div>
          {open && <VenuePanel key={open.venue_id} venue={open} onClose={() => { setOpen(null); focusDetails(open.venue_id) }} />}
        </div>
      )}
    </div>
  )
}
