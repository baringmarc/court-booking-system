import { ApiError } from '../../lib/queryClient'
import { TOO_MANY_RUNS_MESSAGE } from './selection'

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
  // M18 (T18.3): create_walk_in while Plotline has the venue's walk-ins off.
  'walk_ins_off',
  // M19 (T19.1): save_court_promo / delete_court_promo.
  'promo_overlap', 'court_not_found',
  // M30 (T30.5): update_refund.
  'invalid_amount', 'missing_method', 'missing_reason',
  // M33 (T33.1): create_booking_group above its 6-booking cap.
  'too_many_courts',
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
  // The RPC says "courts", but one checkout can hold several times on one court (T33.3).
  if (code === 'too_many_courts') return TOO_MANY_RUNS_MESSAGE
  if (code) return (error as ApiError).message
  return 'Something went wrong. Please check your connection and try again.'
}

/** A multi-booking checkout's error (T33.3): an `invalid_input` means the picked times don't go together. */
export function groupBookingErrorMessage(error: unknown) {
  if (bookingErrorCode(error) === 'invalid_input') return "Those times can't be booked together. Please choose them again."
  return bookingErrorMessage(error)
}
