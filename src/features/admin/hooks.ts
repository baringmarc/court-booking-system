import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  adminCancelBooking,
  adminKeys,
  createWalkIn,
  fetchAdminBookings,
  fetchApprovedPayments,
  fetchProofQueueCount,
  fetchProofUrl,
  removeBanner,
  removeCourtPhoto,
  saveBanner,
  reviewPayment,
  setCourtPhoto,
  type BannerInput,
  type WalkInInput,
} from './api'
import { catalogKeys, type Court, type VenueSettings } from '../catalog/api'
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

// --- venue media -----------------------------------------------------------------

function useCourtPhotoMutation<V>(court: Pick<Court, 'id' | 'photo_path'>, run: (vars: V) => Promise<Court>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: (saved) => {
      qc.setQueryData(catalogKeys.court(saved.id), saved)
      return qc.invalidateQueries({ queryKey: catalogKeys.allCourts })
    },
    // A failed save may still have changed storage; refetch so the page shows what's stored.
    onError: () => qc.invalidateQueries({ queryKey: catalogKeys.court(court.id) }),
  })
}

/** Takes an image that's already downscaled (see imageResize.ts). */
export function useSetCourtPhoto(court: Pick<Court, 'id' | 'photo_path'>) {
  return useCourtPhotoMutation(court, (image: Blob) => setCourtPhoto(court, image))
}

export function useRemoveCourtPhoto(court: Pick<Court, 'id' | 'photo_path'>) {
  return useCourtPhotoMutation<void>(court, () => removeCourtPhoto(court))
}

function useBannerMutation<V>(run: (vars: V) => Promise<VenueSettings>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: (saved) => qc.setQueryData(catalogKeys.settings, saved),
    onError: () => qc.invalidateQueries({ queryKey: catalogKeys.settings }),
  })
}

/** Image (if any) must already be downscaled (see imageResize.ts). */
export function useSaveBanner(settings: Pick<VenueSettings, 'banner_path'>) {
  return useBannerMutation((input: BannerInput) => saveBanner(settings, input))
}

export function useRemoveBanner(settings: Pick<VenueSettings, 'banner_path'>) {
  return useBannerMutation<void>(() => removeBanner(settings))
}
