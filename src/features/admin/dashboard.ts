// Pure logic for the admin dashboard and walk-in form.
import type { Slot } from '../booking/selection'
import { hourOnDate, spansLabel } from '../catalog/hours'

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
    const contiguous = i === startIndex || Date.parse(courtSlots[i - 1].slot_end) === Date.parse(slot.slot_start) && (!courtSlots[i - 1].period_end || Date.parse(slot.slot_start) < Date.parse(courtSlots[i - 1].period_end!))
    if (!contiguous || !isWalkInStartable(slot, now)) break
    count++
  }
  return count
}

/**
 * Today's open hours across every court ("Open 6 AM – 10 PM", "Open 6 AM – 12 PM, 2 PM – 10 PM", "Closed today"),
 * from `get_staff_schedule`'s periods: one per court and period, so overlapping or touching ones are merged.
 */
export function todayHoursLabel(periods: { period_start: string; period_end: string }[], timeZone: string, operatingDate: string): string {
  if (periods.length === 0) return 'Closed today'
  const midnight = Date.parse(hourOnDate(operatingDate, 0, timeZone))
  const spans = periods
    .map((p) => ({ open: (Date.parse(p.period_start) - midnight) / 3_600_000, end: (Date.parse(p.period_end) - midnight) / 3_600_000 }))
    .sort((a, b) => a.open - b.open)
  const merged: { open: number; end: number }[] = []
  for (const span of spans) {
    const last = merged.at(-1)
    if (last && span.open <= last.end) last.end = Math.max(last.end, span.end)
    else merged.push({ ...span })
  }
  const text = spansLabel(merged)
  return text === 'Open 24 hours' ? text : `Open ${text}`
}

/** The booking on now or the next one to start (bookings sorted or not); null when every one has ended. */
export function nextBooking<T extends { slot_start: string; slot_end: string }>(bookings: T[], now: Date): T | null {
  return [...bookings]
    .sort((a, b) => Date.parse(a.slot_start) - Date.parse(b.slot_start))
    .find((b) => Date.parse(b.slot_end) > now.getTime()) ?? null
}
