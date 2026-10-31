import { useVenue } from '../venue/useVenue'
import { useAuth } from './useAuth'

/** Staff or owner of the page's venue. A member of another venue only is not an admin here. RLS is the real check. */
export function useIsVenueAdmin(): boolean {
  const { venueIds } = useAuth()
  const venue = useVenue()
  return venueIds.includes(venue.id)
}
