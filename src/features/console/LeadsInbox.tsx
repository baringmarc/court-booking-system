import { useState } from 'react'
import type { Lead, LeadStatus } from './api'
import { CreateVenueForm } from './CreateVenueForm'
import { useLeads, useUpdateLead } from './hooks'

const LEAD_STATUSES: readonly LeadStatus[] = ['new', 'talking', 'won', 'lost']
const STATUS_LABEL: Record<LeadStatus, string> = { new: 'New', talking: 'Talking', won: 'Won', lost: 'Lost' }

function LeadItem({ lead }: { lead: Lead }) {
  const update = useUpdateLead()
  const [notes, setNotes] = useState(lead.notes ?? '')
  const [creating, setCreating] = useState(false)
  return (
    <li className="card stack">
      <strong>{lead.venue_name}</strong>
      <p>{lead.first_name} {lead.last_name}</p>
      <p className="muted">{lead.email}</p>
      <p className="muted">{lead.phone}</p>
      <p className="muted">{lead.location} · {lead.courts} courts</p>
      <div className="field">
        <label htmlFor={`status-${lead.id}`}>Status</label>
        <select
          id={`status-${lead.id}`}
          value={lead.status}
          onChange={(e) => update.mutate({ id: lead.id, patch: { status: e.target.value as LeadStatus } })}
        >
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`notes-${lead.id}`}>Notes</label>
        <textarea id={`notes-${lead.id}`} rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="btn"
          disabled={update.isPending}
          onClick={() => update.mutate({ id: lead.id, patch: { notes: notes.trim() === '' ? null : notes } })}
        >
          Save notes
        </button>
      </div>
      {(lead.status === 'new' || lead.status === 'talking') && !creating && (
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => setCreating(true)}>Create venue</button>
        </div>
      )}
      {creating && <CreateVenueForm lead={lead} onClose={() => setCreating(false)} />}
      {update.error && <p className="form-error" role="alert">{update.error.message}</p>}
    </li>
  )
}

/** The console's leads inbox (T14.3): contact-form leads with a status filter, status changes and notes. */
export function LeadsInbox() {
  const [filter, setFilter] = useState<LeadStatus | 'all'>('all')
  const leads = useLeads(filter)

  return (
    <section className="stack" aria-labelledby="leads-heading">
      <h2 id="leads-heading">Leads</h2>
      <div className="field">
        <label htmlFor="lead-filter">Filter by status</label>
        <select id="lead-filter" value={filter} onChange={(e) => setFilter(e.target.value as LeadStatus | 'all')}>
          <option value="all">All</option>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      {leads.isPending ? (
        <p className="muted">Loading leads…</p>
      ) : leads.error ? (
        <div className="alert alert-error">
          <p>Couldn't load leads.</p>
          <button type="button" className="btn btn-ghost" onClick={() => void leads.refetch()}>Retry</button>
        </div>
      ) : leads.data.length === 0 ? (
        <p className="muted">{filter === 'all' ? 'No leads yet.' : 'No leads with this status.'}</p>
      ) : (
        <ul className="list">
          {leads.data.map((lead) => <LeadItem key={lead.id} lead={lead} />)}
        </ul>
      )}
    </section>
  )
}
