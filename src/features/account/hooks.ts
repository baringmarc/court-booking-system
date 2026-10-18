import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/useAuth'
import { claimGuestBookings, fetchMyBookings } from './api'

export const accountKeys = {
  /** Prefix for every user's My bookings list: booking mutations invalidate it. */
  allMyBookings: ['my-bookings'] as const,
  myBookings: (userId: string) => ['my-bookings', userId] as const,
  claim: (userId: string) => ['claim-guest-bookings', userId] as const,
}

export function useMyBookings(userId: string | undefined) {
  return useQuery({
    queryKey: accountKeys.myBookings(userId ?? ''),
    queryFn: () => fetchMyBookings(userId!),
    enabled: !!userId,
  })
}

/**
 * Claims earlier guest bookings once per signed-in user and page load (SPEC §5.7), as a query rather
 * than an effect, and never from onAuthStateChange (awaiting Supabase there can deadlock).
 * Only for confirmed emails; the RPC re-checks auth.users itself.
 */
export function useClaimGuestBookings() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const userId = user?.id
  return useQuery({
    queryKey: accountKeys.claim(userId ?? ''),
    queryFn: async () => {
      const count = await claimGuestBookings()
      if (count > 0) await qc.invalidateQueries({ queryKey: accountKeys.myBookings(userId!) })
      return count
    },
    enabled: !!userId && !!user?.email_confirmed_at,
    staleTime: Infinity,
    // No retries: the RPC is idempotent and runs again on the next page load, so a failure only delays it.
    retry: false,
  })
}
