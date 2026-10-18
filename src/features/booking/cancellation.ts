// Client mirror of cancel_booking's rules (SPEC §4), used only to decide what to show.
// The RPC enforces them; a stale page just gets its error message.
import { displayStatus, type BookingStatus } from './status'

type Cancellable = { status: BookingStatus; expires_at: string | null; slot_start: string; slot_end: string }

export type PlayerCancel =
  | { kind: 'allowed'; deadline: Date }
  | { kind: 'closed'; deadline: Date }
  | { kind: 'not_active' }

/** Holds a slot right now: a live hold, a submitted proof, or a confirmed booking that hasn't ended. */
export function isActive(booking: Cancellable, now: Date) {
  const status = displayStatus(booking, now)
  return status === 'pending_payment' || status === 'payment_submitted' || status === 'confirmed'
}

/** Players and guests can cancel until `cutoffHours` before the start (exactly at the deadline still counts). */
export function playerCancel(booking: Cancellable, cutoffHours: number, now: Date): PlayerCancel {
  if (!isActive(booking, now)) return { kind: 'not_active' }
  const deadline = new Date(Date.parse(booking.slot_start) - cutoffHours * 3_600_000)
  return now.getTime() <= deadline.getTime() ? { kind: 'allowed', deadline } : { kind: 'closed', deadline }
}

/** Admins can cancel any active booking until it ends. */
export function adminCanCancel(booking: Cancellable, now: Date) {
  return isActive(booking, now) && now.getTime() < Date.parse(booking.slot_end)
}
