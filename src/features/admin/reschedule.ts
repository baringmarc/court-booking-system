// Pure rules for the Reschedule form (T10.10). The server (reschedule_booking) decides; these only choose what to offer.
import type { Slot } from '../booking/selection'
import type { BookingStatus } from '../booking/status'
import { maxWalkInSlots } from './dashboard'

const HOUR_MS = 3_600_000

type Movable = { status: BookingStatus; slot_start: string; slot_end: string }

/** Staff can move a confirmed booking until it ends. */
export function adminCanReschedule(booking: Movable, now: Date) {
  return booking.status === 'confirmed' && now.getTime() < Date.parse(booking.slot_end)
}

/** Whether the booking's first hour has begun (before that, the whole booking moves). */
export function hasStarted(booking: Movable, now: Date) {
  return Date.parse(booking.slot_start) <= now.getTime()
}

/**
 * Where a move can start once the booking has begun: the hour in progress or any later hour (an earlier one is over).
 * Empty before the start, when the whole booking moves.
 */
export function moveFromOptions(booking: Movable, now: Date): string[] {
  if (!hasStarted(booking, now)) return []
  const options: string[] = []
  for (let t = Date.parse(booking.slot_start); t < Date.parse(booking.slot_end); t += HOUR_MS) {
    if (t + HOUR_MS > now.getTime()) options.push(new Date(t).toISOString())
  }
  return options
}

/** The hours that move: from `fromStart` to the booking's end. */
export function movedHours(booking: Movable, fromStart: string) {
  return Math.round((Date.parse(booking.slot_end) - Date.parse(fromStart)) / HOUR_MS)
}

/** Whether the move splits the booking: it already started and the move begins after its first hour. */
export function isSplit(booking: Movable, fromStart: string) {
  return Date.parse(fromStart) > Date.parse(booking.slot_start)
}

/**
 * Starts on one court where `hours` back-to-back hours are free under the walk-in rules the RPC uses (the hour in
 * progress counts as free). `courtSlots` are that court's slots for the day, sorted by start.
 */
export function validStarts(courtSlots: Slot[], hours: number, now: Date): Slot[] {
  return courtSlots.filter((_, i) => maxWalkInSlots(courtSlots, i, now) >= hours)
}

/** The end of `hours` hours from `start`. */
export function endAfter(start: string, hours: number) {
  return new Date(Date.parse(start) + hours * HOUR_MS).toISOString()
}
