import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TablesInsert, TablesUpdate } from '../../lib/database.types'
import {
  catalogKeys,
  createBlackout,
  deleteBlackout,
  fetchCourt,
  fetchCourtRates,
  fetchCourts,
  fetchOperatingHours,
  fetchUpcomingBlackouts,
  fetchVenueSettings,
  saveCourt,
  saveCourtRates,
  saveOperatingHours,
  updateVenueSettings,
  type CourtInput,
  type CourtWithPhotos,
  type OperatingHours,
  type RateChanges,
} from './api'

export function useVenueSettings() {
  return useQuery({ queryKey: catalogKeys.settings, queryFn: fetchVenueSettings, staleTime: 5 * 60_000 })
}

export function useCourts({ includeInactive = false } = {}) {
  return useQuery({
    queryKey: catalogKeys.courts(includeInactive),
    queryFn: () => fetchCourts(includeInactive),
  })
}

export function useCourt(id: string | undefined) {
  return useQuery({
    queryKey: catalogKeys.court(id ?? ''),
    queryFn: () => fetchCourt(id!),
    enabled: !!id,
  })
}

export function useCourtRates(courtId: string | undefined) {
  return useQuery({
    queryKey: catalogKeys.rates(courtId ?? ''),
    queryFn: () => fetchCourtRates(courtId!),
    enabled: !!courtId,
  })
}

export function useOperatingHours() {
  return useQuery({ queryKey: catalogKeys.hours, queryFn: fetchOperatingHours })
}

export function useUpcomingBlackouts() {
  return useQuery({ queryKey: catalogKeys.blackouts, queryFn: fetchUpcomingBlackouts })
}

// --- mutations ---------------------------------------------------------------

export function useSaveCourt(id: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CourtInput) => saveCourt(id, input),
    onSuccess: (court) => {
      // The saved row has no photos: merge it into the cached court rather than replacing it.
      qc.setQueryData<CourtWithPhotos>(catalogKeys.court(court.id), (old) => (old ? { ...old, ...court } : old))
      return qc.invalidateQueries({ queryKey: catalogKeys.allCourts })
    },
  })
}

export function useSaveCourtRates(courtId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (changes: RateChanges) => saveCourtRates(courtId, changes),
    onSettled: () => qc.invalidateQueries({ queryKey: catalogKeys.rates(courtId) }),
  })
}

export function useSaveOperatingHours() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rows: OperatingHours[]) => saveOperatingHours(rows),
    onSettled: () => qc.invalidateQueries({ queryKey: catalogKeys.hours }),
  })
}

export function useCreateBlackout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<TablesInsert<'blackouts'>, 'venue_id'>) => createBlackout(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: catalogKeys.blackouts }),
  })
}

export function useDeleteBlackout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteBlackout(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: catalogKeys.blackouts }),
  })
}

export function useUpdateVenueSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (values: TablesUpdate<'venue_settings'>) => updateVenueSettings(values),
    onSuccess: (settings) => qc.setQueryData(catalogKeys.settings, settings),
  })
}
