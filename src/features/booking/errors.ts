import { ApiError } from '../../lib/queryClient'

/** Stable error codes raised (as HINT) by the booking RPCs. See RESEARCH.md "RPC conventions". */
const CODES = [
  'slot_unavailable', 'slot_started', 'outside_window', 'multi_day', 'outside_hours',
  'not_aligned', 'blackout', 'court_inactive', 'invalid_guest', 'invalid_input', 'not_found',
  // Payments (M4): proof RPCs, the submit-payment-proof Edge Function, review_payment, create_walk_in.
  'hold_expired', 'invalid_state', 'file_too_large', 'invalid_file_type', 'upload_failed',
  'forbidden', 'note_required',
] as const

export type BookingErrorCode = (typeof CODES)[number]

const isCode = (value: string): value is BookingErrorCode => (CODES as readonly string[]).includes(value)

export function bookingErrorCode(error: unknown): BookingErrorCode | null {
  return error instanceof ApiError && error.hint && isCode(error.hint) ? error.hint : null
}

/** The chosen time can no longer be booked: send the user back to the grid to pick again. */
export function isSlotGone(error: unknown) {
  const code = bookingErrorCode(error)
  return code === 'slot_unavailable' || code === 'slot_started' || code === 'blackout' || code === 'court_inactive'
}

/** User-facing text. Booking RPC messages are written for users; anything else gets a generic line. */
export function bookingErrorMessage(error: unknown) {
  if (bookingErrorCode(error)) return (error as ApiError).message
  return 'Something went wrong. Please check your connection and try again.'
}
