import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  adminCancelBooking,
  adminKeys,
  createWalkIn,
  fetchAdminBookings,
  fetchApprovedPayments,
  fetchProofQueueCount,
  fetchProofUrl,
  reviewPayment,
  type WalkInInput,
} from './api'
import { bookingKeys } from '../booking/hooks'
import type { BookingFilters } from './bookingFilters'

export function useAdminBookings(filters: BookingFilters, timeZone: string | undefined) {
  return useQuery({
    queryKey: adminKeys.bookings(filters),
    queryFn: () => fetchAdminBookings(filters, timeZone!),
    enabled: !!timeZone,
    staleTime: 15_000,
    refetchInterval: 60_000,
  })
}

export function useProofUrl(path: string | null) {
  return useQuery({
    queryKey: adminKeys.proofUrl(path ?? ''),
    queryFn: () => fetchProofUrl(path!),
    enabled: !!path,
    staleTime: 45_000, // links are valid for 60 s
  })
}

export function useReviewPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ bookingId, approve, note }: { bookingId: string; approve: boolean; note: string | null }) =>
      reviewPayment(bookingId, approve, note),
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: adminKeys.allBookings }),
      qc.invalidateQueries({ queryKey: adminKeys.proofQueue }),
      qc.invalidateQueries({ queryKey: adminKeys.allTakings }),
      qc.invalidateQueries({ queryKey: bookingKeys.allAvailability }),
    ]),
  })
}

export function useAdminCancelBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ bookingId, reason }: { bookingId: string; reason: string }) => adminCancelBooking(bookingId, reason),
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: adminKeys.allBookings }),
      qc.invalidateQueries({ queryKey: adminKeys.proofQueue }),
      qc.invalidateQueries({ queryKey: bookingKeys.allAvailability }),
    ]),
  })
}

export function useProofQueueCount() {
  return useQuery({ queryKey: adminKeys.proofQueue, queryFn: fetchProofQueueCount, staleTime: 15_000, refetchInterval: 60_000 })
}

/** Approved payments in the venue-local day [fromIso, toIso). */
export function useTakings(fromIso: string, toIso: string) {
  return useQuery({ queryKey: adminKeys.takings(fromIso), queryFn: () => fetchApprovedPayments(fromIso, toIso), staleTime: 30_000 })
}

export function useCreateWalkIn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: WalkInInput) => createWalkIn(input),
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: adminKeys.allBookings }),
      qc.invalidateQueries({ queryKey: adminKeys.allTakings }),
      qc.invalidateQueries({ queryKey: bookingKeys.allAvailability }),
    ]),
  })
}
