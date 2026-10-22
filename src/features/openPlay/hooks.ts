import { useQuery } from '@tanstack/react-query'
import { fetchUpcomingOpenPlay, openPlayKeys } from './api'

export function useUpcomingOpenPlay({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: openPlayKeys.upcoming, queryFn: fetchUpcomingOpenPlay, enabled })
}
