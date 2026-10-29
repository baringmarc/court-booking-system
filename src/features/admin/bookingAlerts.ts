// The admin tab alert (T11.21, SPEC §10 2026-10-28): what counts as news, and the background tab's title.
import type { BookingStatus } from '../booking/status'

/** One booking_changed broadcast (private.broadcast_booking_change): ids and statuses only. */
export type BookingChange = { booking_id: string; status: BookingStatus; old_status: BookingStatus | null; source: string }

/** A proof came in, or a hold was paid online. New holds, walk-ins, approvals and reschedules aren't news. */
export function countsAsNew({ status, old_status }: BookingChange) {
  if (old_status === status) return false
  return status === 'payment_submitted' || (status === 'confirmed' && old_status === 'pending_payment')
}

export function alertTitle(count: number, venueName: string) {
  return `(${count}) New bookings · ${venueName}`
}
