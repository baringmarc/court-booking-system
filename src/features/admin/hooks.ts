import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  adminCancelBooking,
  adminKeys,
  createWalkIn,
  fetchAdminBookings,
  fetchEarnings,
  fetchProofQueueCount,
  fetchProofUrl,
  deleteCourt,
  moveCourt,
  removeBanner,
  removeCourtPhoto,
  addCourtPhoto,
  reorderCourtPhotos,
  saveBanner,
  saveOpenPlay,
  deleteOpenPlay,
  saveSocialLinks,
  saveInfoSection,
  deleteInfoSection,
  moveInfoSection,
  setBuiltinAmenity,
  addCustomAmenity,
  removeAmenity,
  type InfoSectionInput,
  reviewPayment,
  type BannerInput,
  type WalkInInput,
} from './api'
import { catalogKeys, updateVenueSettings, type Court, type CourtPhotoRow, type CourtWithPhotos, type Sport, type VenueSettings } from '../catalog/api'
import { moveCourtInList } from '../catalog/sportOrder'
import { bookingKeys } from '../booking/hooks'
import { openPlayKeys, type OpenPlayInput } from '../openPlay/api'
import { venueKeys, type Amenity } from '../venue/api'
import type { AmenityKey } from '../venue/amenities'
import type { SocialPlatform } from '../venue/social'
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
      qc.invalidateQueries({ queryKey: adminKeys.allEarnings }),
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

/** The earnings summary for venue dates from–to (T10.7). */
export function useEarnings(from: string, to: string, enabled = true) {
  return useQuery({ queryKey: adminKeys.earnings(from, to), queryFn: () => fetchEarnings(from, to), staleTime: 30_000, enabled })
}

export function useCreateWalkIn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: WalkInInput) => createWalkIn(input),
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: adminKeys.allBookings }),
      qc.invalidateQueries({ queryKey: adminKeys.allEarnings }),
      qc.invalidateQueries({ queryKey: bookingKeys.allAvailability }),
    ]),
  })
}

// --- ordering (T9.4) --------------------------------------------------------------

// Reorders update the screen at once but are saved one at a time (`scope`), so quick repeated presses reach the
// server in order. onMutate is synchronous on purpose: TanStack calls it inside mutate(), so the next press already
// sees the new order. An in-flight refetch is then cancelled without reverting, so it can't overwrite it. Only the last pending reorder refreshes from the server or rolls
// back: an earlier one finishing would otherwise overwrite the newer order on screen, move the row back and
// drop keyboard focus (T9.4 review). The current mutation is still counted by isMutating while it settles.
const MOVE_COURT_KEY = ['move-court'] as const
const SPORT_ORDER_KEY = ['save-sport-order'] as const

/**
 * Moves a court up or down within its sport. The admin list (all courts) is reordered at once, then refetched;
 * public lists and the /book grid refetch too.
 */
export function useMoveCourt() {
  const qc = useQueryClient()
  const key = catalogKeys.courts(true)
  const isLast = () => qc.isMutating({ mutationKey: MOVE_COURT_KEY }) <= 1
  return useMutation({
    mutationKey: MOVE_COURT_KEY,
    scope: { id: 'move-court' },
    mutationFn: ({ id, direction }: { id: string; direction: -1 | 1 }) => moveCourt(id, direction),
    onMutate: ({ id, direction }) => {
      const previous = qc.getQueryData<Court[]>(key)
      if (previous) qc.setQueryData(key, moveCourtInList(previous, id, direction))
      void qc.cancelQueries({ queryKey: key }, { revert: false })
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (isLast() && context?.previous) qc.setQueryData(key, context.previous)
    },
    onSettled: () => {
      if (!isLast()) return
      return Promise.all([
        qc.invalidateQueries({ queryKey: catalogKeys.allCourts }),
        qc.invalidateQueries({ queryKey: bookingKeys.allAvailability }),
      ])
    },
  })
}

/** Saves the sport order. Settings update at once; court lists and the /book grid refetch in the new order. */
export function useSaveSportOrder() {
  const qc = useQueryClient()
  const isLast = () => qc.isMutating({ mutationKey: SPORT_ORDER_KEY }) <= 1
  return useMutation({
    mutationKey: SPORT_ORDER_KEY,
    scope: { id: 'save-sport-order' },
    mutationFn: (order: Sport[]) => updateVenueSettings({ sport_order: order }),
    onMutate: (order) => {
      const previous = qc.getQueryData<VenueSettings>(catalogKeys.settings)
      if (previous) qc.setQueryData(catalogKeys.settings, { ...previous, sport_order: order })
      void qc.cancelQueries({ queryKey: catalogKeys.settings }, { revert: false })
      return { previous }
    },
    onSuccess: (saved) => {
      if (isLast()) qc.setQueryData(catalogKeys.settings, saved)
    },
    onError: (_error, _order, context) => {
      if (isLast() && context?.previous) qc.setQueryData(catalogKeys.settings, context.previous)
    },
    onSettled: () => {
      if (!isLast()) return
      // Settings come from the last save's response (onSuccess); courts and the grid refetch in the new order.
      return Promise.all([
        qc.invalidateQueries({ queryKey: catalogKeys.allCourts }),
        qc.invalidateQueries({ queryKey: bookingKeys.allAvailability }),
      ])
    },
  })
}

/** Deletes a court that was never booked (T9.5). Its page and the lists drop it; the /book grid refetches. */
export function useDeleteCourt(courtId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => deleteCourt(courtId),
    onSuccess: () => {
      // Not awaited, so the page can navigate away straight after; the deleted court's own query is dropped.
      qc.removeQueries({ queryKey: catalogKeys.court(courtId) })
      void qc.invalidateQueries({ queryKey: catalogKeys.allCourts })
      void qc.invalidateQueries({ queryKey: catalogKeys.blackouts }) // its court blackouts went with it
      void qc.invalidateQueries({ queryKey: bookingKeys.allAvailability })
    },
  })
}

// --- venue media -----------------------------------------------------------------

const REORDER_PHOTOS_KEY = ['reorder-court-photos'] as const

/** After a gallery change: the court page and every court list (covers on cards) refetch. */
function refreshCourt(qc: QueryClient, courtId: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: catalogKeys.court(courtId) }),
    qc.invalidateQueries({ queryKey: catalogKeys.allCourts }),
  ])
}

/** Adds an already downscaled image (see imageResize.ts) at the given place in the gallery. */
export function useAddCourtPhoto(courtId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ image, sortOrder }: { image: Blob; sortOrder: number }) => addCourtPhoto(courtId, image, sortOrder),
    onSettled: () => refreshCourt(qc, courtId),
  })
}

export function useRemoveCourtPhoto(courtId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (photo: CourtPhotoRow) => removeCourtPhoto(photo),
    onSettled: () => refreshCourt(qc, courtId),
  })
}

/**
 * Reorders the gallery (the first photo is the cover). Same pattern as useMoveCourt: the page updates at once
 * (synchronous onMutate), saves run one at a time, and only the last pending one refetches or rolls back.
 */
export function useReorderCourtPhotos(courtId: string) {
  const qc = useQueryClient()
  const key = catalogKeys.court(courtId)
  const isLast = () => qc.isMutating({ mutationKey: REORDER_PHOTOS_KEY }) <= 1
  return useMutation({
    mutationKey: REORDER_PHOTOS_KEY,
    scope: { id: `reorder-court-photos-${courtId}` },
    mutationFn: (ids: string[]) => reorderCourtPhotos(courtId, ids),
    onMutate: (ids) => {
      const previous = qc.getQueryData<CourtWithPhotos>(key)
      if (previous) {
        const byId = new Map(previous.court_photos.map((p) => [p.id, p]))
        const court_photos = ids.flatMap((id, i) => {
          const photo = byId.get(id)
          return photo ? [{ ...photo, sort_order: i }] : []
        })
        qc.setQueryData<CourtWithPhotos>(key, { ...previous, court_photos })
      }
      void qc.cancelQueries({ queryKey: key }, { revert: false })
      return { previous }
    },
    onError: (_error, _ids, context) => {
      if (isLast() && context?.previous) qc.setQueryData(key, context.previous)
    },
    onSettled: () => (isLast() ? refreshCourt(qc, courtId) : undefined),
  })
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

/** An open play change moves slots in and out of open play, so availability refetches too (T9.11d). */
function useInvalidateOpenPlay() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: openPlayKeys.all })
    void qc.invalidateQueries({ queryKey: bookingKeys.allAvailability })
  }
}

export function useSaveOpenPlay() {
  const invalidate = useInvalidateOpenPlay()
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: OpenPlayInput }) => saveOpenPlay(id, input),
    onSuccess: invalidate,
  })
}

export function useDeleteOpenPlay() {
  const invalidate = useInvalidateOpenPlay()
  return useMutation({ mutationFn: (id: string) => deleteOpenPlay(id), onSuccess: invalidate })
}

// --- Venue info (T9.11h) -------------------------------------------------------

export function useSaveSocialLinks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (links: Record<SocialPlatform, string>) => saveSocialLinks(links),
    // Only on success: a refetch remounts the form, which would drop what the admin typed.
    onSuccess: () => qc.invalidateQueries({ queryKey: venueKeys.socials }),
  })
}

export function useSaveInfoSection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: InfoSectionInput }) => saveInfoSection(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: venueKeys.sections }),
  })
}

export function useDeleteInfoSection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteInfoSection(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: venueKeys.sections }),
  })
}

export function useMoveInfoSection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, direction }: { id: string; direction: -1 | 1 }) => moveInfoSection(id, direction),
    onSettled: () => qc.invalidateQueries({ queryKey: venueKeys.sections }),
  })
}

/** The section shows the change at once (its own state); on success the cache takes it over, then refetches. */
export function useSetBuiltinAmenity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, on }: { key: AmenityKey; on: boolean }) => setBuiltinAmenity(key, on),
    onSuccess: (_data, { key, on }) => {
      qc.setQueryData<Amenity[]>(venueKeys.amenities, (rows = []) => on
        ? [...rows.filter((r) => r.builtin_key !== key),
            { id: `saved-${key}`, builtin_key: key, custom_name: null, created_at: new Date().toISOString() }]
        : rows.filter((r) => r.builtin_key !== key))
      void qc.invalidateQueries({ queryKey: venueKeys.amenities })
    },
  })
}

export function useAddCustomAmenity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => addCustomAmenity(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: venueKeys.amenities }),
  })
}

export function useRemoveAmenity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => removeAmenity(id),
    onSettled: () => qc.invalidateQueries({ queryKey: venueKeys.amenities }),
  })
}
