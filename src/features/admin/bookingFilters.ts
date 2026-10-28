// Filters for /admin/bookings, kept in the URL so the review queue is linkable from the dashboard.
import { Constants, type Enums } from '../../lib/database.types'
import { addDays, zonedLocalToISO } from '../../lib/time'

export type BookingStatus = Enums<'booking_status'>
export type BookingSource = Enums<'booking_source'>
/** Play time (`during`) or when it was booked (`created_at`), newest or oldest first (T11.5b). */
export type BookingSort = 'play-desc' | 'play-asc' | 'booked-desc' | 'booked-asc'
export const SORTS: readonly { value: BookingSort; label: string }[] = [
  { value: 'play-desc', label: 'Play time, latest first' },
  { value: 'play-asc', label: 'Play time, earliest first' },
  { value: 'booked-desc', label: 'Booked on, newest first' },
  { value: 'booked-asc', label: 'Booked on, oldest first' },
]

export type BookingFilters = {
  status: BookingStatus | 'all'
  source: BookingSource | 'all'
  date: string | null
  /** Search text (T11.5b); while it's set, the other filters are set aside. */
  q: string
  /** Null: the default, which depends on the date (see effectiveSort). */
  sort: BookingSort | null
}

/** The review queue is the default view. */
export const DEFAULT_FILTERS: BookingFilters = { status: 'payment_submitted', source: 'all', date: null, q: '', sort: null }

/**
 * A day reads in time order; otherwise the latest play time comes first (as before T11.5b). A search sets the date
 * aside, so it defaults to latest first too.
 */
export function effectiveSort(filters: Pick<BookingFilters, 'date' | 'sort'> & { q?: string }): BookingSort {
  const day = filters.date && parseSearch(filters.q ?? '').kind === 'none'
  return filters.sort ?? (day ? 'play-asc' : 'play-desc')
}

export const SEARCH_MAX = 100
// A booking reference as players see it: "CB-" and six letters or digits, without I, O, 0 or 1 (the DB check).
const REFERENCE = /^(?:CB-?)?([A-HJ-NP-Z2-9]{6})$/i

export type BookingSearch =
  | { kind: 'none' }
  /**
   * `filter` is a PostgREST or() list over reference, contact name and contact email. `code` is set when the text is
   * a whole reference ("CB-7KQ2XD", any case, with or without "CB-"): the page opens that booking.
   */
  | { kind: 'text'; filter: string; code: string | null }

/**
 * What the search box asks for (T11.5b): text of at least 2 characters, matched against part of a reference, the
 * contact name or the contact email. A whole reference code also matches that code exactly (so "cb7kq2xd" finds
 * "CB-7KQ2XD"); it's still a text search, since a six-letter name like "Marcus" can look like a code.
 * The text is escaped for LIKE (\\, % and _ are literal; * is dropped, since PostgREST reads it as a wildcard) and
 * quoted for the or() list, so commas, parentheses and quotes can't change the filter.
 */
export function parseSearch(text: string): BookingSearch {
  const q = text.trim().replace(/\s+/g, ' ').slice(0, SEARCH_MAX)
  const ref = q.match(REFERENCE)
  const code = ref ? `CB-${ref[1].toUpperCase()}` : null
  const term = q.replace(/\*/g, '')
  if (term.length < 2) return { kind: 'none' }
  const like = term.replace(/[\\%_]/g, (c) => `\\${c}`)
  const quoted = `"*${like.replace(/[\\"]/g, (c) => `\\${c}`)}*"`
  const clauses = ['reference_code', 'guest_name', 'guest_email'].map((col) => `${col}.ilike.${quoted}`)
  if (code) clauses.unshift(`reference_code.eq.${code}`)
  return { kind: 'text', filter: clauses.join(','), code }
}

const STATUSES: readonly string[] = Constants.public.Enums.booking_status
const SOURCES: readonly string[] = Constants.public.Enums.booking_source

export function filtersFromParams(params: URLSearchParams): BookingFilters {
  const status = params.get('status')
  const source = params.get('source')
  const date = params.get('date')
  const sort = params.get('sort')
  return {
    status: status === 'all' || (status && STATUSES.includes(status)) ? (status as BookingFilters['status']) : DEFAULT_FILTERS.status,
    source: source && SOURCES.includes(source) ? (source as BookingSource) : 'all',
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    q: (params.get('q') ?? '').trim().slice(0, SEARCH_MAX),
    sort: SORTS.some((s) => s.value === sort) ? (sort as BookingSort) : null,
  }
}

export function filtersToParams(filters: BookingFilters) {
  const params = new URLSearchParams()
  if (filters.status !== DEFAULT_FILTERS.status) params.set('status', filters.status)
  if (filters.source !== 'all') params.set('source', filters.source)
  if (filters.date) params.set('date', filters.date)
  if (filters.q.trim()) params.set('q', filters.q.trim())
  if (filters.sort) params.set('sort', filters.sort)
  return params
}

/** A venue-local day as a Postgres range literal, for overlap filtering on `bookings.during`. */
export function dayRangeLiteral(date: string, timeZone: string) {
  return `[${zonedLocalToISO(`${date}T00:00`, timeZone)},${zonedLocalToISO(`${addDays(date, 1)}T00:00`, timeZone)})`
}
