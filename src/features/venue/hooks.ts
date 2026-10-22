import { useQuery } from '@tanstack/react-query'
import { fetchAmenities, fetchInfoSections, fetchSocialLinks, venueKeys } from './api'

export function useSocialLinks() {
  return useQuery({ queryKey: venueKeys.socials, queryFn: fetchSocialLinks, staleTime: 5 * 60_000 })
}

export function useInfoSections() {
  return useQuery({ queryKey: venueKeys.sections, queryFn: fetchInfoSections, staleTime: 5 * 60_000 })
}

export function useAmenities() {
  return useQuery({ queryKey: venueKeys.amenities, queryFn: fetchAmenities, staleTime: 5 * 60_000 })
}
