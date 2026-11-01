import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createVenue, fetchInvoiceDetail, fetchInvoicesOverview, fetchIsPlatformAdmin, fetchLeads, fetchReviews, fetchVenuesOverview, inviteVenueOwner, markInvoicePaid, markInvoiceSent,
  resendOwnerInvite,
  reactivateVenue, setReviewApproved, suspendVenue, updateLead, type Lead, type LeadStatus,
} from './api'

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

/**
 * Creates the venue, invites its owner and marks the lead won. The created venue id is kept, so retrying after a
 * failed invite does not create the venue twice; the lead is marked won only once the invite went out.
 */
export function useCreateVenueFromLead() {
  const queryClient = useQueryClient()
  const createdVenueId = useRef<string | null>(null)
  return useMutation({
    mutationFn: async (input: { lead: Lead; slug: string; name: string; timezone: string; email: string }) => {
      createdVenueId.current ??= await createVenue({ slug: input.slug, name: input.name, timezone: input.timezone })
      await inviteVenueOwner({ venueId: createdVenueId.current, email: input.email })
      await updateLead(input.lead.id, { status: 'won' })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  })
}

/** Sends a venue's owner a fresh invite or sign-in link (T14.5d). */
export function useResendOwnerInvite() {
  return useMutation({ mutationFn: (input: { venueId: string; email: string }) => resendOwnerInvite(input) })
}

export function useVenuesOverview() {
  return useQuery({ queryKey: ['venues-overview'], queryFn: fetchVenuesOverview })
}

export function useSuspendVenue() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (venueId: string) => suspendVenue(venueId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['venues-overview'] }),
  })
}

export function useReactivateVenue() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (venueId: string) => reactivateVenue(venueId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['venues-overview'] }),
  })
}

export function useInvoices() {
  return useQuery({ queryKey: ['invoices'], queryFn: fetchInvoicesOverview })
}

export function useInvoiceDetail(invoiceId: string) {
  return useQuery({ queryKey: ['invoices', invoiceId], queryFn: () => fetchInvoiceDetail(invoiceId) })
}

function useInvoiceMutation<T>(mutationFn: (input: T) => Promise<void>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['venues-overview'] }),
      ])
    },
  })
}

export function useMarkInvoiceSent() {
  return useInvoiceMutation((invoiceId: string) => markInvoiceSent(invoiceId))
}

export function useMarkInvoicePaid() {
  return useInvoiceMutation((input: { invoiceId: string; method: string; reference: string }) => markInvoicePaid(input))
}

export function useReviews() {
  return useQuery({ queryKey: ['reviews'], queryFn: fetchReviews })
}

export function useSetReviewApproved() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) => setReviewApproved(id, approved),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reviews'] }),
  })
}
