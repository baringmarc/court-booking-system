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
 * The sorted list after moving one court up (-1) or down (1) within its sport, with that sport renumbered
 * 0..n-1 like move_court does. Unchanged at the edges or for an unknown id.
 */
export function moveCourtInList<T extends Orderable>(courts: readonly T[], id: string, direction: -1 | 1): T[] {
  const court = courts.find((c) => c.id === id)
  if (!court) return [...courts]
  const group = courts.filter((c) => c.sport === court.sport)
  const from = group.indexOf(court)
  const to = from + direction
  if (to < 0 || to >= group.length) return [...courts]
  const moved = [...group]
  ;[moved[from], moved[to]] = [moved[to], moved[from]]
  const renumbered = new Map(moved.map((c, i) => [c.id, { ...c, sort_order: i }]))
  // Keep the other sports where they are; refill this sport's positions in its new order.
  let next = 0
  return courts.map((c) => (c.sport === court.sport ? renumbered.get(moved[next++].id)! : c))
}

/** One past the highest sort_order in a sport, so a new court goes last. */
export function nextSortOrder(courts: readonly Pick<Court, 'sport' | 'sort_order'>[], sport: Sport): number {
  return Math.max(-1, ...courts.filter((c) => c.sport === sport).map((c) => c.sort_order)) + 1
}

/** A list with the item at `index` swapped with its neighbour; unchanged at the edges. */
export function moveItem<T>(list: readonly T[], index: number, direction: -1 | 1): T[] {
  const to = index + direction
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list]
  const next = [...list]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}
