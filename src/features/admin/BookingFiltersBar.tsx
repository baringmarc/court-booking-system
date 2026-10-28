import { Constants } from '../../lib/database.types'
import { STATUS_LABELS } from '../booking/status'
import { useState, type FormEvent } from 'react'
import { effectiveSort, parseSearch, SEARCH_MAX, SORTS, type BookingFilters, type BookingSort } from './bookingFilters'

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
      <div className="field">
        <label htmlFor="filter-sort">Sort by</label>
        {/* Picking the default for the current view clears the choice, so the URL stays short. */}
        <select id="filter-sort" value={effectiveSort(filters)}
          onChange={(e) => {
            const sort = e.target.value as BookingSort
            onChange({ ...filters, sort: sort === effectiveSort({ ...filters, sort: null }) ? null : sort })
          }}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
    </div>
  )
}

/**
 * The bookings search (T11.5b): a reference code, or part of a reference, name or email. It runs on submit (Enter or
 * the button); the page keeps the text in the URL. Remount with `key` to reset it when the URL changes.
 */
export function BookingSearchForm({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [text, setText] = useState(value)
  const [tooShort, setTooShort] = useState(false)
  function submit(e: FormEvent) {
    e.preventDefault()
    const q = text.trim()
    // An empty box clears the search; one character (or only "*") isn't a search yet, so say so.
    const short = q !== '' && parseSearch(q).kind === 'none'
    setTooShort(short)
    if (!short) onSearch(q)
  }
  return (
    <form role="search" className="booking-search" aria-label="Search bookings" onSubmit={submit}>
      <label htmlFor="booking-search" className="field-label">Search</label>
      <div className="booking-search-row">
        <input id="booking-search" type="search" value={text} maxLength={SEARCH_MAX} autoComplete="off"
          placeholder="Reference (CB-…), name or email" aria-describedby={tooShort ? 'booking-search-hint' : undefined}
          aria-invalid={tooShort || undefined} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn">Search</button>
      </div>
      {tooShort && <p id="booking-search-hint" className="form-error" role="alert">Type at least 2 characters to search.</p>}
    </form>
  )
}
