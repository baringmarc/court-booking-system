import { useRef } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createVenue, deleteLead, deleteUnusedVenue, fetchInvoiceDetailPage, fetchVenueDeletionPreview, retryVenueFileCleanup, fetchInvoicesPage, fetchIsPlatformAdmin, fetchLeadsPage, fetchReviewsPage, fetchVenuesPage,
  inviteVenueOwner, markInvoicePaid, markInvoiceSent, resendOwnerInvite, fetchShowcaseApprovals, setVenueShowcaseApproval, fetchOnlinePayments, setOnlinePayments,
  reactivateVenue, setReviewApproved, suspendVenue, updateLead, type Lead, type LeadStatus, type ReviewFilter,
} from './api'

export function useIsPlatformAdmin(userId: string | undefined) {
  const query = useQuery({
    queryKey: ['platform-admin', userId ?? null],
    queryFn: () => fetchIsPlatformAdmin(userId!),
    enabled: !!userId,
  })
  return { isPlatformAdmin: query.data === true, isPending: !!userId && query.isPending, error: query.error, refetch: query.refetch }
}

// Console list pages (T17.19). Each key starts with the prefix the existing mutations invalidate, so an action
// reloads the visible page; the previous page stays on screen while the next one loads.
export function useLeadsPage(filters: { status: LeadStatus | 'all'; search: string; page: number }) {
  return useQuery({ queryKey: ['leads', 'page', filters], queryFn: () => fetchLeadsPage(filters), placeholderData: keepPreviousData })
}

export function useVenuesPage(filters: { search: string; status: string; page: number }) {
  return useQuery({ queryKey: ['venues-overview', 'page', filters], queryFn: () => fetchVenuesPage(filters), placeholderData: keepPreviousData })
}

export function useInvoicesPage(filters: { search: string; status: string; month: string; page: number }) {
  return useQuery({ queryKey: ['invoices', 'page', filters], queryFn: () => fetchInvoicesPage(filters), placeholderData: keepPreviousData })
}

export function useInvoiceDetailPage(invoiceId: string, page: number) {
  return useQuery({
    queryKey: ['invoices', 'detail', invoiceId, page],
    queryFn: () => fetchInvoiceDetailPage({ invoiceId, page }),
    placeholderData: keepPreviousData,
  })
}

export function useReviewsPage(filters: { approved: ReviewFilter; search: string; page: number }) {
  return useQuery({ queryKey: ['reviews', 'page', filters], queryFn: () => fetchReviewsPage(filters), placeholderData: keepPreviousData })
}

export function useUpdateLead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { status?: LeadStatus; notes?: string | null } }) => updateLead(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  })
}

export function useDeleteLead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (leadId: string) => deleteLead(leadId),
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

export function useOnlinePayments() {
  return useQuery({ queryKey: ['online-payments'], queryFn: fetchOnlinePayments, refetchOnWindowFocus: true })
}

export function useSetOnlinePayments() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { venueId: string; enabled: boolean }) => setOnlinePayments(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['online-payments'] }),
        queryClient.invalidateQueries({ queryKey: ['venues-overview'] }),
      ])
    },
  })
}

export function useShowcaseApprovals() {
  return useQuery({ queryKey: ['showcase-approvals'], queryFn: fetchShowcaseApprovals, refetchOnWindowFocus: true })
}

export function useSetVenueShowcaseApproval() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { venueId: string; approved: boolean }) => setVenueShowcaseApproval(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['showcase-approvals'] }),
        queryClient.invalidateQueries({ queryKey: ['venues-overview'] }),
      ])
    },
  })
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

/**
 * Loaded only while the delete dialog is open; always fresh, since a booking can arrive at any time. Kept outside
 * the 'venues-overview' key so the delete's own invalidation doesn't refetch it for a venue that no longer exists.
 */
export function useVenueDeletionPreview(venueId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['venue-deletion-preview', venueId],
    queryFn: () => fetchVenueDeletionPreview(venueId),
    enabled,
    staleTime: 0,
  })
}

function useVenueDeletionMutation<T>(mutationFn: (input: T) => Promise<{ cleanup: 'done' | 'pending' }>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['venues-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['showcase-approvals'] }),
      ])
    },
  })
}

export function useDeleteUnusedVenue() {
  return useVenueDeletionMutation((input: { venueId: string; confirmSlug: string }) => deleteUnusedVenue(input))
}

export function useRetryVenueFileCleanup() {
  return useVenueDeletionMutation((venueId: string) => retryVenueFileCleanup(venueId))
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

export function useSetReviewApproved() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) => setReviewApproved(id, approved),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reviews'] }),
  })
}
