import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { accountKeys } from '../account/hooks'
import { bookingErrorCode } from './errors'
import { goToCheckout, rememberCheckoutStart, rememberGuestToken } from './paymongoReturn'
import {
  cancelBooking,
  createBooking,
  fetchAvailability,
  fetchGuestBooking,
  fetchOwnBooking,
  fetchPlatformFee,
  requestGuestLinkEmail,
  startPaymongoCheckout,
  submitPaymentProof,
  type BookingDetail,
  type Cancellation,
  type NewBooking,
  type ProofSubmission,
} from './api'
import { currentVenueId } from '../../lib/currentVenue'

export const bookingKeys = {
  // Availability is venue data, so its keys start with the venue id; bookings are found by reference code.
  allAvailability: () => [currentVenueId(), 'availability'] as const,
  availability: (date: string) => [currentVenueId(), 'availability', date] as const,
  allDetails: ['booking'] as const,
  detail: (ref: string, token: string | null) => ['booking', ref.toUpperCase(), token] as const,
  platformFee: ['platform-fee'] as const,
}

export function usePlatformFee() {
  return useQuery({ queryKey: bookingKeys.platformFee, queryFn: fetchPlatformFee, staleTime: 5 * 60_000 })
}

export function useAvailability(date: string) {
  return useQuery({
    queryKey: bookingKeys.availability(date),
    queryFn: () => fetchAvailability(date),
    staleTime: 15_000,
    refetchInterval: 60_000,
  })
}

export function useCreateBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: NewBooking) => createBooking(input),
    // A guest's booking email carries their private link, so only this page can ask for it (it has the token).
    // Fire and forget: the booking already succeeded, and without this call the email still goes out, minus the link.
    onSuccess: ({ referenceCode, guestToken }) => {
      if (guestToken) requestGuestLinkEmail({ referenceCode, token: guestToken }).catch(() => {})
    },
    // Success and "slot taken" both mean the grid is stale; a new booking also belongs in My bookings.
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: bookingKeys.allAvailability() }),
      qc.invalidateQueries({ queryKey: accountKeys.allMyBookings }),
    ]),
  })
}

/**
 * With a token (even an empty one from a cut-off link), read as a guest; without one, as the logged-in owner through
 * RLS. `pollMs` can ask, for the booking as last fetched, for polling (e.g. while waiting for PayMongo's webhook).
 */
export function useBooking(ref: string | undefined, token: string | null, { pollMs }: { pollMs?: (booking: BookingDetail) => number | null } = {}) {
  return useQuery({
    queryKey: bookingKeys.detail(ref ?? '', token),
    queryFn: () => (token !== null ? fetchGuestBooking(ref!, token) : fetchOwnBooking(ref!)),
    enabled: !!ref,
    retry: (count, error) => bookingErrorCode(error) !== 'not_found' && count < 1,
    // While staff review a proof, poll so a confirmation or rejection (and the re-upload prompt) appears on its own.
    refetchInterval: (query) => {
      const data = query.state.data
      const requested = data ? pollMs?.(data) : null
      if (requested) return requested
      return data?.status === 'payment_submitted' ? 30_000 : false
    },
  })
}

/** Starts the PayMongo checkout and leaves for it; a guest's token is kept in this tab for the way back. */
export function useStartPaymongoCheckout(ref: string, token: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => startPaymongoCheckout({ referenceCode: ref, token }),
    onSuccess: (url) => {
      if (token) rememberGuestToken(ref, token)
      rememberCheckoutStart(ref, Date.now())
      goToCheckout(url)
    },
    // A hold_expired or invalid_state error means the booking changed under us.
    onError: () => qc.invalidateQueries({ queryKey: bookingKeys.detail(ref, token) }),
  })
}

export function useSubmitPaymentProof(ref: string, token: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<ProofSubmission, 'referenceCode' | 'token'>) =>
      submitPaymentProof({ ...input, referenceCode: ref, token }),
    // Success moves the booking to payment_submitted; a hold_expired/invalid_state error also means it changed.
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: bookingKeys.detail(ref, token) }),
      qc.invalidateQueries({ queryKey: accountKeys.allMyBookings }),
    ]),
  })
}

export function useCancelBooking(ref: string, token: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<Cancellation, 'referenceCode' | 'token'>) => cancelBooking({ ...input, referenceCode: ref, token }),
    // Success frees the slot; a cutoff or state error also means the page is out of date.
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: bookingKeys.detail(ref, token) }),
      qc.invalidateQueries({ queryKey: bookingKeys.allAvailability() }),
      qc.invalidateQueries({ queryKey: accountKeys.allMyBookings }),
    ]),
  })
}
