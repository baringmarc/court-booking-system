// Pure logic for the admin dashboard and walk-in form.
import type { Slot } from '../booking/selection'

/**
 * One operating day's bookings from the calendar-date lists fetched for it (T9.10): each booking once (one that
 * crosses midnight comes back in both lists), only those starting within the day's open hours, by start time.
 */
export function operatingDayBookings<T extends { id: string; slot_start: string }>(
  lists: T[][], open: { start: string; end: string } | null,
): T[] {
  const byId = new Map<string, T>()
  for (const list of lists) for (const b of list) byId.set(b.id, b)
  const inDay = (start: string) => !open || (Date.parse(start) >= Date.parse(open.start) && Date.parse(start) < Date.parse(open.end))
  return [...byId.values()].filter((b) => inDay(b.slot_start)).sort((a, b) => Date.parse(a.slot_start) - Date.parse(b.slot_start))
}

/**
 * Walk-ins may start in the slot that is in progress (SPEC §5.8). Availability reports a started slot as `past`
 * only when it is free (booked/blackout win once a slot has started), so `past` + not ended = free right now.
 */
export function isWalkInStartable(slot: Slot, now: Date) {
  return slot.status === 'free' || (slot.status === 'past' && Date.parse(slot.slot_end) > now.getTime())
}

/** How many consecutive slots a walk-in starting at `startIndex` can take (all startable and back to back). */
export function maxWalkInSlots(courtSlots: Slot[], startIndex: number, now: Date) {
  let count = 0
  for (let i = startIndex; i < courtSlots.length; i++) {
    const slot = courtSlots[i]
    const contiguous = i === startIndex || courtSlots[i - 1].slot_end === slot.slot_start
    if (!contiguous || !isWalkInStartable(slot, now)) break
    count++
  }
  return count
}
