import { Constants } from '../../lib/database.types'
import { STATUS_LABELS } from '../booking/status'
import type { BookingFilters } from './bookingFilters'

const SOURCE_LABELS = { online: 'Online', walk_in: 'Walk-in', moved: 'Moved' } as const

export function BookingFiltersBar({ filters, onChange }: { filters: BookingFilters; onChange: (next: BookingFilters) => void }) {
  return (
    <div className="form-grid filters" role="group" aria-label="Filters">
      <div className="field">
        <label htmlFor="filter-status">Status</label>
        <select id="filter-status" value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.target.value as BookingFilters['status'] })}>
          <option value="all">All statuses</option>
          {Constants.public.Enums.booking_status.map((s) => (
            <option key={s} value={s}>{s === 'payment_submitted' ? 'Needs review' : STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="filter-source">Source</label>
        <select id="filter-source" value={filters.source}
          onChange={(e) => onChange({ ...filters, source: e.target.value as BookingFilters['source'] })}>
          <option value="all">All sources</option>
          {Constants.public.Enums.booking_source.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="filter-date">Date</label>
        <input id="filter-date" type="date" value={filters.date ?? ''}
          onChange={(e) => onChange({ ...filters, date: e.target.value || null })} />
      </div>
    </div>
  )
}
