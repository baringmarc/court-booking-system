// Sport and court order (SPEC §6, T9.3/T9.4). The database's get_availability and move_court use the same rules:
// sports in venue_settings.sport_order, then courts by sort_order and name.
import type { Court } from './api'
import { SPORTS, type Sport } from './sports'

type Orderable = Pick<Court, 'id' | 'sport' | 'sort_order' | 'name'>

/** The venue's sport order, or the default order if it's missing or doesn't list every sport exactly once. */
export function orderedSports(order: readonly Sport[] | null | undefined): Sport[] {
  const valid = !!order && order.length === SPORTS.length && SPORTS.every((s) => order.includes(s))
  return valid ? [...order] : [...SPORTS]
}

/** Courts sorted by sport (in the venue's order), then sort_order, then name. */
export function sortCourts<T extends Orderable>(courts: readonly T[], order: readonly Sport[] | null | undefined): T[] {
  const sports = orderedSports(order)
  return [...courts].sort(
    (a, b) =>
      sports.indexOf(a.sport) - sports.indexOf(b.sport) ||
      a.sort_order - b.sort_order ||
      a.name.localeCompare(b.name),
  )
}

/** The sports that have courts, in the order they first appear in an already sorted list. */
export function sportsOf(courts: readonly Pick<Court, 'sport'>[]): Sport[] {
  return [...new Set(courts.map((c) => c.sport))]
}

/**
 * The sorted list with one sport's courts put in the order of `ids` (all of that sport's ids) and renumbered 0..n-1,
 * like reorder_courts does (T11.5a). Other sports keep their places. Unchanged when `ids` doesn't match the sport.
 */
export function setCourtOrder<T extends Orderable>(courts: readonly T[], sport: Sport, ids: readonly string[]): T[] {
  const group = courts.filter((c) => c.sport === sport)
  const byId = new Map(group.map((c) => [c.id, c]))
  if (ids.length !== group.length || new Set(ids).size !== ids.length || !ids.every((id) => byId.has(id))) return [...courts]
  const ordered = ids.map((id, i) => ({ ...byId.get(id)!, sort_order: i }))
  // Refill this sport's positions in its new order.
  let next = 0
  return courts.map((c) => (c.sport === sport ? ordered[next++] : c))
}

/** One past the highest sort_order in a sport, so a new court goes last. */
export function nextSortOrder(courts: readonly Pick<Court, 'sport' | 'sort_order'>[], sport: Sport): number {
  return Math.max(-1, ...courts.filter((c) => c.sport === sport).map((c) => c.sort_order)) + 1
}

