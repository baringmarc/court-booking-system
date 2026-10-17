// Filters for /admin/bookings, kept in the URL so the review queue is linkable from the dashboard.
import { Constants, type Enums } from '../../lib/database.types'
import { addDays, zonedLocalToISO } from '../../lib/time'

export type BookingStatus = Enums<'booking_status'>
export type BookingSource = Enums<'booking_source'>
export type BookingFilters = { status: BookingStatus | 'all'; source: BookingSource | 'all'; date: string | null }

/** The review queue is the default view. */
export const DEFAULT_FILTERS: BookingFilters = { status: 'payment_submitted', source: 'all', date: null }

const STATUSES: readonly string[] = Constants.public.Enums.booking_status
const SOURCES: readonly string[] = Constants.public.Enums.booking_source

export function filtersFromParams(params: URLSearchParams): BookingFilters {
  const status = params.get('status')
  const source = params.get('source')
  const date = params.get('date')
  return {
    status: status === 'all' || (status && STATUSES.includes(status)) ? (status as BookingFilters['status']) : DEFAULT_FILTERS.status,
    source: source && SOURCES.includes(source) ? (source as BookingSource) : 'all',
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
  }
}

export function filtersToParams(filters: BookingFilters) {
  const params = new URLSearchParams()
  if (filters.status !== DEFAULT_FILTERS.status) params.set('status', filters.status)
  if (filters.source !== 'all') params.set('source', filters.source)
  if (filters.date) params.set('date', filters.date)
  return params
}

/** A venue-local day as a Postgres range literal, for overlap filtering on `bookings.during`. */
export function dayRangeLiteral(date: string, timeZone: string) {
  return `[${zonedLocalToISO(`${date}T00:00`, timeZone)},${zonedLocalToISO(`${addDays(date, 1)}T00:00`, timeZone)})`
}
