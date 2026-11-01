import { useState, type FormEvent } from 'react'
import type { Lead } from './api'
import { useCreateVenueFromLead } from './hooks'
import { suggestSlug } from './venueSlug'

const ROOT_DOMAIN = 'plotline.fit'

function errorText(error: { message: string; hint?: string }) {
  if (error.hint === 'slug_taken') return 'That subdomain is already taken. Pick another.'
  if (error.hint === 'slug_reserved') return 'That subdomain is reserved. Pick another.'
  return error.message
}

/** Creates a draft venue from a lead, invites the owner and marks the lead won (T14.6). */
export function CreateVenueForm({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const create = useCreateVenueFromLead()
  const [name, setName] = useState(lead.venue_name)
  const [slug, setSlug] = useState(suggestSlug(lead.venue_name))
  const [timezone, setTimezone] = useState('Asia/Manila')
  const [email, setEmail] = useState(lead.email)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    create.mutate({ lead, slug: slug.trim(), name: name.trim(), timezone: timezone.trim(), email: email.trim() })
  }

  if (create.isSuccess) {
    return (
      <div className="stack">
        <p role="status">{name} is created as a draft at {slug}.plotline.fit and {email} is invited as its owner.</p>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    )
  }

  const error = create.error as (Error & { hint?: string }) | null
  return (
    <form className="stack" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor={`cv-name-${lead.id}`}>Venue name</label>
        <input id={`cv-name-${lead.id}`} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} />
      </div>
      <div className="field">
        <label htmlFor={`cv-slug-${lead.id}`}>Subdomain</label>
        <input id={`cv-slug-${lead.id}`} value={slug} onChange={(e) => setSlug(e.target.value)} required minLength={3} maxLength={40} />
        <p className="muted">{slug}.{ROOT_DOMAIN}</p>
      </div>
      <div className="field">
        <label htmlFor={`cv-tz-${lead.id}`}>Timezone</label>
        <input id={`cv-tz-${lead.id}`} value={timezone} onChange={(e) => setTimezone(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor={`cv-email-${lead.id}`}>Owner email</label>
        <input id={`cv-email-${lead.id}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      {error && <p className="form-error" role="alert">{errorText(error)}</p>}
      <div className="form-actions">
        <button type="submit" className="btn" disabled={create.isPending}>Create venue and invite owner</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </form>
  )
}
