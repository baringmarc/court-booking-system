import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchIsPlatformAdmin, fetchLeads, updateLead, type LeadStatus } from './api'

export function useIsPlatformAdmin(userId: string | undefined) {
  const query = useQuery({
    queryKey: ['platform-admin', userId ?? null],
    queryFn: () => fetchIsPlatformAdmin(userId!),
    enabled: !!userId,
  })
  return { isPlatformAdmin: query.data === true, isPending: !!userId && query.isPending, error: query.error, refetch: query.refetch }
}

export function useLeads(status: LeadStatus | 'all') {
  return useQuery({ queryKey: ['leads', status], queryFn: () => fetchLeads(status) })
}

export function useUpdateLead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { status?: LeadStatus; notes?: string | null } }) => updateLead(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  })
}
