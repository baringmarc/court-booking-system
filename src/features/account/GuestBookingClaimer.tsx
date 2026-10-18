import { useClaimGuestBookings } from './hooks'

/** Mounted once at the app root: attaches earlier guest bookings after sign-in and on page load. */
export function GuestBookingClaimer() {
  useClaimGuestBookings()
  return null
}
