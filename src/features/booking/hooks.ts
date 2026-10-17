import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { bookingErrorCode } from './errors'
import {
  createBooking,
  fetchAvailability,
  fetchGuestBooking,
  fetchOwnBooking,
  submitPaymentProof,
  type NewBooking,
  type ProofSubmission,
} from './api'

export const bookingKeys = {
  allAvailability: ['availability'] as const,
  availability: (date: string) => ['availability', date] as const,
  detail: (ref: string, token: string | null) => ['booking', ref.toUpperCase(), token] as const,
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
    // Success and "slot taken" both mean the grid is stale.
    onSettled: () => qc.invalidateQueries({ queryKey: bookingKeys.allAvailability }),
  })
}

/** With a token (even an empty one from a cut-off link), read as a guest; without one, as the logged-in owner through RLS. */
export function useBooking(ref: string | undefined, token: string | null) {
  return useQuery({
    queryKey: bookingKeys.detail(ref ?? '', token),
    queryFn: () => (token !== null ? fetchGuestBooking(ref!, token) : fetchOwnBooking(ref!)),
    enabled: !!ref,
    retry: (count, error) => bookingErrorCode(error) !== 'not_found' && count < 1,
    // While staff review a proof, poll so a confirmation or rejection (and the re-upload prompt) appears on its own.
    refetchInterval: (query) => (query.state.data?.status === 'payment_submitted' ? 30_000 : false),
  })
}

export function useSubmitPaymentProof(ref: string, token: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<ProofSubmission, 'referenceCode' | 'token'>) =>
      submitPaymentProof({ ...input, referenceCode: ref, token }),
    // Success moves the booking to payment_submitted; a hold_expired/invalid_state error also means it changed.
    onSettled: () => qc.invalidateQueries({ queryKey: bookingKeys.detail(ref, token) }),
  })
}
