import { useQuery } from '@tanstack/react-query'
import { fetchMemberVenues } from '../auth/api'
import { useAuth } from '../auth/useAuth'
import { useVenue } from '../venue/useVenue'
import { venueAdminUrl } from '../../lib/venueUrl'

/** For a member of several venues: links to the other venues' admin (each venue is its own subdomain). */
export function VenueSwitcher() {
  const { user, venueIds } = useAuth()
  const current = useVenue()
  const { data } = useQuery({
    queryKey: ['member-venues', user?.id],
    queryFn: () => fetchMemberVenues(user!.id),
    enabled: !!user && venueIds.length > 1,
  })
  const others = (data ?? []).filter((v) => v.id !== current.id)
  if (!user || venueIds.length < 2 || others.length === 0) return null
  const { protocol, hostname, port } = window.location
  return (
    <nav aria-label="Venues" className="venue-switcher">
      {others.map((v) => (
        <a key={v.id} className="btn btn-small btn-ghost" href={venueAdminUrl(v.slug, { protocol, hostname, port })}>{v.slug}</a>
      ))}
    </nav>
  )
}
