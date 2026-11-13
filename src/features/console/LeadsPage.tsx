import { useState } from 'react'
import type { Lead, LeadStatus } from './api'
import { CreateVenueForm } from './CreateVenueForm'
import { DeleteLeadDialog } from './DeleteLeadDialog'
import { useLeadsPage, useUpdateLead } from './hooks'
import { DetailsButton, ListStatus, RecordPanel, SearchField, StatusBadge, StatusFilter } from './ListControls'
import { focusDetails, returnFocus, useListParams } from './listParams'
import { Pager } from './Pager'

const LEAD_STATUSES: readonly LeadStatus[] = ['new', 'talking', 'won', 'lost']
const STATUS_LABEL: Record<LeadStatus, string> = { new: 'New', talking: 'Talking', won: 'Won', lost: 'Lost' }
const FILTER_OPTIONS = [['all', 'All'], ...LEAD_STATUSES.map((s) => [s, STATUS_LABEL[s]] as const)] as const

const DELETE_LEAD_BUTTON = 'delete-lead-open'

function LeadPanel({ lead, notes, onNotes, onSaved, onClose, onDelete }: {
  lead: Lead; notes: string; onNotes: (text: string) => void; onSaved: () => void; onClose: () => void; onDelete: () => void
}) {
  const update = useUpdateLead()
  const [creating, setCreating] = useState(false)
  return (
    <RecordPanel label={`Lead: ${lead.venue_name}`} title={lead.venue_name} onClose={onClose}>
      <p>{lead.first_name} {lead.last_name}</p>
      <p className="muted">{lead.email}</p>
      <p className="muted">{lead.phone}</p>
      <p className="muted">{lead.location} · {lead.courts} courts</p>
      <div className="field">
        <label htmlFor={`status-${lead.id}`}>Status</label>
        <select id={`status-${lead.id}`} value={lead.status}
          onChange={(e) => update.mutate({ id: lead.id, patch: { status: e.target.value as LeadStatus } })}>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`notes-${lead.id}`}>Notes</label>
        <textarea id={`notes-${lead.id}`} rows={4} maxLength={2000} value={notes} onChange={(e) => onNotes(e.target.value)} />
      </div>
      <div className="form-actions">
        <button type="button" className="btn" disabled={update.isPending}
          onClick={() => update.mutate({ id: lead.id, patch: { notes: notes.trim() === '' ? null : notes } }, { onSuccess: onSaved })}>
          Save notes
        </button>
      </div>
      {(lead.status === 'new' || lead.status === 'talking') && !creating && (
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => setCreating(true)}>Create venue</button>
        </div>
      )}
      {creating && <CreateVenueForm lead={lead} onClose={() => setCreating(false)} />}
      <div className="form-actions">
        <button type="button" id={DELETE_LEAD_BUTTON} className="btn btn-ghost" onClick={onDelete}>Delete lead</button>
      </div>
      {update.error && <p className="form-error" role="alert">{update.error.message}</p>}
    </RecordPanel>
  )
}

/** The console's Leads page (T14.3, routed and paged in T17.19): search, status filter, 25 per page, details on demand. */
export function LeadsPage() {
  const { state, setFilter, setPage, setOpen, setView } = useListParams(LEAD_STATUSES)
  const status = (state.status || 'all') as LeadStatus | 'all'
  const leads = useLeadsPage({ status, search: state.q, page: state.page })
  // Unsaved notes, per lead, kept while the admin pages, filters or closes the panel; dropped once saved.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState<{ lead: Lead; lastOnPage: boolean } | null>(null)
  const [deletedName, setDeletedName] = useState<string | null>(null)
  const rows = leads.data?.rows ?? []
  const open = rows.find((lead) => lead.id === state.open)
  const filtered = status !== 'all' || state.q !== ''

  function close(id: string) {
    setOpen(null)
    focusDetails(id)
  }

  function cancelDelete() {
    setDeleting(null)
    returnFocus(DELETE_LEAD_BUTTON)
  }

  function deleted(target: { lead: Lead; lastOnPage: boolean }) {
    setDeleting(null)
    setDeletedName(target.lead.venue_name)
    // The last row of a page past the first: step back, so the list never lands on an empty page.
    setView({ open: null, page: target.lastOnPage && state.page > 1 ? state.page - 1 : state.page })
  }

  return (
    <div className="stack console-page">
      <h1>Leads</h1>
      {deletedName && <p role="status">The lead for {deletedName} was deleted.</p>}
      <div className="console-filters">
        <SearchField id="lead-search" label="Search leads" value={state.q} onSearch={(q) => setFilter({ q })} />
        <StatusFilter id="lead-filter" value={status} options={FILTER_OPTIONS} onChange={(v) => setFilter({ status: v === 'all' ? '' : v })} />
      </div>
      <ListStatus noun="leads" pending={leads.isPending} error={leads.error} onRetry={() => void leads.refetch()}
        empty={leads.isSuccess && leads.data.total === 0}
        filtered={!filtered ? 'No leads yet.' : status !== 'all' ? 'No leads with this status.' : 'No leads match this search.'} />
      {leads.data && leads.data.total > 0 && (
        <div className={`console-records${open ? ' has-panel' : ''}`}>
          <div className="stack">
            <ul className="list console-rows">
              {rows.map((lead) => (
                <li key={lead.id} className="card console-row">
                  <div className="console-row-main">
                    <strong>{lead.venue_name}</strong>
                    <span className="muted small">{lead.first_name} {lead.last_name} · {lead.location}</span>
                  </div>
                  <StatusBadge status={lead.status}>{STATUS_LABEL[lead.status as LeadStatus] ?? lead.status}</StatusBadge>
                  <DetailsButton id={lead.id} name={lead.venue_name} onOpen={() => setOpen(lead.id)} />
                </li>
              ))}
            </ul>
            <Pager label="Leads pages" page={state.page} total={leads.data.total} onPage={setPage} />
          </div>
          {open && (
            <LeadPanel key={open.id} lead={open} notes={drafts[open.id] ?? open.notes ?? ''}
              onNotes={(text) => setDrafts((d) => ({ ...d, [open.id]: text }))}
              onSaved={() => setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([id]) => id !== open.id)))}
              onClose={() => close(open.id)} onDelete={() => { setDeletedName(null); setDeleting({ lead: open, lastOnPage: rows.length === 1 }) }} />
          )}
        </div>
      )}
      {deleting && <DeleteLeadDialog lead={deleting.lead} onCancel={cancelDelete} onDeleted={() => deleted(deleting)} />}
    </div>
  )
}
