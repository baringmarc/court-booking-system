import type { Enums } from '../../lib/database.types'

export type BookingStatus = Enums<'booking_status'>
/** `completed` is display-only: a confirmed booking whose end time has passed. */
export type DisplayStatus = BookingStatus | 'completed'

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  pending_payment: 'Waiting for payment',
  payment_submitted: 'Payment under review',
  confirmed: 'Confirmed',
  completed: 'Completed',
  expired: 'Expired',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

/**
 * The status to show. A pending hold whose expires_at has passed is expired even before the
 * server sweep runs (same rule as the RPCs: expired once expires_at <= now). SPEC §4, §10.
 */
export function displayStatus(
  booking: { status: BookingStatus; expires_at: string | null; slot_end: string },
  now = new Date(),
): DisplayStatus {
  if (booking.status === 'pending_payment' && booking.expires_at && new Date(booking.expires_at) <= now) return 'expired'
  if (booking.status === 'confirmed' && new Date(booking.slot_end) <= now) return 'completed'
  return booking.status
}
