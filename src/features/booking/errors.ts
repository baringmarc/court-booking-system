import { ApiError } from '../../lib/queryClient'

/** Stable error codes raised (as HINT) by the booking RPCs. See RESEARCH.md "RPC conventions". */
const CODES = [
  'slot_unavailable', 'slot_started', 'outside_window', 'multi_day', 'outside_hours',
  'not_aligned', 'blackout', 'court_inactive', 'invalid_guest', 'invalid_input', 'not_found',
  // Payments (M4): proof RPCs, the submit-payment-proof Edge Function, review_payment, create_walk_in.
  'hold_expired', 'invalid_state', 'file_too_large', 'invalid_file_type', 'upload_failed',
  'forbidden', 'note_required',
  // Accounts (M5): cancel_booking.
  'not_cancellable', 'cutoff_passed', 'booking_ended', 'reason_required',
  // Online payments (M7): the create-paymongo-checkout Edge Function.
  'payments_unavailable', 'payments_failed', 'amount_too_low',
  // M11 (T11.22): the venue's online payments switch is off.
  'online_payments_off',
  // Open play (M9, T9.11c): validate_booking_slot and the session RPCs.
  'open_play', 'invalid_links', 'session_overlap', 'session_started',
  // Rescheduling (M10, T10.9): reschedule_booking.
  'not_confirmed', 'from_past', 'different_sport', 'no_change', 'try_again',
  // M11: the phone trigger (T11.17) and the venue waiver (T11.19).
  'invalid_phone', 'waiver_required',
] as const

export type BookingErrorCode = (typeof CODES)[number]

const isCode = (value: string): value is BookingErrorCode => (CODES as readonly string[]).includes(value)

export function bookingErrorCode(error: unknown): BookingErrorCode | null {
  return error instanceof ApiError && error.hint && isCode(error.hint) ? error.hint : null
}

/** The chosen time can no longer be booked: send the user back to the grid to pick again. */
export function isSlotGone(error: unknown) {
  const code = bookingErrorCode(error)
  return code === 'slot_unavailable' || code === 'slot_started' || code === 'blackout' || code === 'open_play' || code === 'court_inactive'
}

/** User-facing text. Booking RPC messages are written for users; anything else gets a generic line. */
export function bookingErrorMessage(error: unknown) {
  const code = bookingErrorCode(error)
  // The checkbox is ours, so the wording is too (an older server sends its own text).
  if (code === 'waiver_required') return 'Please read and accept the waiver to book.'
  if (code) return (error as ApiError).message
  return 'Something went wrong. Please check your connection and try again.'
}
