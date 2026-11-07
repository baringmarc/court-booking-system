import { ConsoleDialog } from './ConsoleDialog'
import type { Lead } from './api'
import { useDeleteLead } from './hooks'

/** Confirms deleting one lead (T17.28). Its notes go with it; a venue created from it is kept. */
export function DeleteLeadDialog({ lead, onCancel, onDeleted }: { lead: Lead; onCancel: () => void; onDeleted: () => void }) {
  const remove = useDeleteLead()
  return (
    <ConsoleDialog id="delete-lead" title="Delete lead?" onCancel={onCancel}>
      <p>{lead.first_name} {lead.last_name} from {lead.venue_name} will be removed from the leads list.</p>
      <p className="muted">Its notes will be lost. A venue already created from this lead, and its owner's account, are kept.</p>
      {remove.error && <p className="form-error" role="alert">{remove.error.message}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn-outline" autoFocus onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-danger" disabled={remove.isPending}
          onClick={() => remove.mutate(lead.id, { onSuccess: onDeleted })}>
          Delete lead
        </button>
      </div>
    </ConsoleDialog>
  )
}
