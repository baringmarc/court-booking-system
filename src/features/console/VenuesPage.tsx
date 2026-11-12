import { startTransition, useState, type FormEvent } from 'react'
import { formatMoney } from '../../lib/format'
import type { OwnerInviteSent, VenueOverview } from './api'
import { DeleteVenueDialog } from './DeleteVenueDialog'
import { useInviteVenueStaff, useReactivateVenue, useResendOwnerInvite, useSuspendVenue, useVenuesPage } from './hooks'
import { DetailsButton, ListStatus, PanelSection, RecordPanel, SearchField, StatusBadge, StatusFilter } from './ListControls'
import { focusDetails, returnFocus, useListParams } from './listParams'
import { Pager } from './Pager'
import { OnlinePaymentsControl } from './OnlinePaymentsControl'
import { ShowcaseControl } from './ShowcaseControl'
import { WalkInsControl } from './WalkInsControl'

const VENUE_STATUSES = ['active', 'draft', 'suspended'] as const
const FILTER_OPTIONS = [['', 'All'], ['active', 'Active'], ['draft', 'Draft'], ['suspended', 'Suspended']] as const

type InviteMutation = ReturnType<typeof useResendOwnerInvite>

/** An email form that sends someone a way into the venue's admin; the owner and staff forms share it. */
function InviteForm({ venue, invite, title, hint, openLabel, emailLabel, submitLabel }: {
  venue: VenueOverview; invite: InviteMutation; title: string; hint: string; openLabel: string; emailLabel: string; submitLabel: string
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    invite.mutate({ venueId: venue.venue_id, email })
  }

  const sent = invite.data?.sent
  return (
    <div className="setting-row">
      <div className="setting-text">
        <p className="setting-title">{title}</p>
        <p className="muted small">{hint}</p>
      </div>
      {!open && (
        <div className="setting-action">
          <button type="button" className="btn btn-outline btn-small" onClick={() => setOpen(true)}>{openLabel}</button>
        </div>
      )}
      {open && (
        <form className="invite-form setting-wide" onSubmit={handleSubmit}>
          <label className="field">
            <span>{emailLabel}</span>
            <input type="email" autoComplete="off" required value={email} onChange={(e) => { setEmail(e.target.value); invite.reset() }} />
          </label>
          <button type="submit" className="btn btn-small" disabled={invite.isPending}>{submitLabel}</button>
          {sent && <p className="invite-sent" role="status">{SENT_MESSAGE[sent]} is on its way to {email}.</p>}
          {invite.error && <p className="form-error" role="alert">{invite.error.message}</p>}
        </form>
      )}
    </div>
  )
}

/** Re-sends the owner a way in: the first invite can be used up, expired or never delivered (T14.5d). */
function ResendInvite({ venue }: { venue: VenueOverview }) {
  return <InviteForm venue={venue} invite={useResendOwnerInvite()} title="Owner" hint="Send the owner a fresh way in."
    openLabel="Resend invite" emailLabel="Owner email" submitLabel="Send invite" />
}

/** Invites a staff member to set up their own admin account for the venue, whatever its status (T24.2). */
function InviteStaff({ venue }: { venue: VenueOverview }) {
  return <InviteForm venue={venue} invite={useInviteVenueStaff()} title="Staff" hint="Give a staff member their own admin account."
    openLabel="Invite staff" emailLabel="Staff email" submitLabel="Send staff invite" />
}

const SENT_MESSAGE: Record<OwnerInviteSent, string> = {
  invite: 'An account setup invitation',
  link: 'A fresh access link',
  welcome: 'A welcome email with the sign-in link',
}

const DELETE_VENUE_BUTTON = 'delete-venue-open'

function VenuePanel({ venue, onClose, onDelete }: { venue: VenueOverview; onClose: () => void; onDelete: () => void }) {
  const suspend = useSuspendVenue()
  const reactivate = useReactivateVenue()
  const error = suspend.error ?? reactivate.error
  return (
    <RecordPanel label={`Venue: ${venue.name}`} title={venue.name} onClose={onClose}>
      <p className="panel-meta"><span className="muted">{venue.slug}</span><StatusBadge status={venue.status} /></p>
      <div className="stat-tiles">
        <div className="stat-tile"><span className="stat-label">This month</span><span className="stat-value">{venue.month_transactions} transactions</span></div>
        <div className="stat-tile"><span className="stat-label">Month total</span><span className="stat-value">{formatMoney(venue.month_total)}</span></div>
        <div className="stat-tile"><span className="stat-label">Billing</span><span className="stat-value">{venue.open_invoices} open {venue.open_invoices === 1 ? 'invoice' : 'invoices'}</span></div>
      </div>
      <PanelSection title="Features">
        <ShowcaseControl venue={venue} />
        <OnlinePaymentsControl venue={venue} />
        <WalkInsControl venue={venue} />
      </PanelSection>
      <PanelSection title="Access">
        <ResendInvite venue={venue} />
        <InviteStaff venue={venue} />
      </PanelSection>
      <PanelSection title="Danger zone" danger>
        <div className="form-actions">
          {venue.status === 'active' && (
            <button type="button" className="btn btn-outline btn-small btn-danger-outline" disabled={suspend.isPending} onClick={() => {
              if (window.confirm(`Suspend ${venue.name}? Players will no longer be able to book.`)) suspend.mutate(venue.venue_id)
            }}>
              Suspend
            </button>
          )}
          {venue.status === 'suspended' && (
            <button type="button" className="btn btn-small" disabled={reactivate.isPending} onClick={() => reactivate.mutate(venue.venue_id)}>Reactivate</button>
          )}
          <button type="button" id={DELETE_VENUE_BUTTON} className="btn btn-outline btn-small btn-danger-outline" onClick={onDelete}>Delete venue</button>
        </div>
        {error && <p className="form-error" role="alert">{error.message}</p>}
      </PanelSection>
    </RecordPanel>
  )
}

/** The console's Venues page (T14.8, routed and paged in T17.19): status, month totals and actions in each venue's panel. */
export function VenuesPage() {
  const { state, setFilter, setPage, setOpen, setView } = useListParams(VENUE_STATUSES)
  const [deleting, setDeleting] = useState<{ venue: VenueOverview; lastOnPage: boolean } | null>(null)
  const [deletedMessage, setDeletedMessage] = useState<string | null>(null)
  const venues = useVenuesPage({ search: state.q, status: state.status, page: state.page })
  const rows = venues.data?.rows ?? []
  const open = rows.find((venue) => venue.venue_id === state.open)
  const filtered = state.status !== '' || state.q !== ''

  function cancelDelete() {
    setDeleting(null)
    returnFocus(DELETE_VENUE_BUTTON)
  }

  function deleted(target: { venue: VenueOverview; lastOnPage: boolean }, cleanupPending = false) {
    // One transition, since the router applies URL changes in one: the dialog and the deleted venue's panel close together.
    startTransition(() => {
      setDeleting(null)
      setDeletedMessage(cleanupPending
        ? `${target.venue.name} was deleted. Its file cleanup is still pending and is retried with the next venue deletion.`
        : `${target.venue.name} was deleted.`)
      // Measured when the dialog opened: the row is already gone from the list once cleanup has been retried.
      setView({ open: null, page: target.lastOnPage && state.page > 1 ? state.page - 1 : state.page })
    })
  }

  return (
    <div className="stack console-page">
      <h1>Venues</h1>
      {deletedMessage && <p role="status">{deletedMessage}</p>}
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
                  <StatusBadge status={venue.status} />
                  <DetailsButton id={venue.venue_id} name={venue.name} onOpen={() => setOpen(venue.venue_id)} />
                </li>
              ))}
            </ul>
            <Pager label="Venues pages" page={state.page} total={venues.data.total} onPage={setPage} />
          </div>
          {open && <VenuePanel key={open.venue_id} venue={open} onClose={() => { setOpen(null); focusDetails(open.venue_id) }}
            onDelete={() => { setDeletedMessage(null); setDeleting({ venue: open, lastOnPage: rows.length === 1 }) }} />}
        </div>
      )}
      {deleting && <DeleteVenueDialog key={deleting.venue.venue_id} venue={deleting.venue} onCancel={cancelDelete}
        onDeleted={() => deleted(deleting)} onClosePending={() => deleted(deleting, true)} />}
    </div>
  )
}
