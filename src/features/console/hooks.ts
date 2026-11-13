import { useRef } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createVenue, deleteLead, deleteUnusedVenue, fetchInvoiceDetailPage, fetchVenueDeletionPreview, retryVenueFileCleanup, fetchInvoicesPage, fetchIsPlatformAdmin, fetchLeadsPage, fetchReviewsPage, fetchVenuesPage,
  inviteVenueOwner, inviteVenueStaff, markInvoicePaid, markInvoiceSent, fetchInvoicePdf, sendInvoice, resendOwnerInvite, fetchShowcaseApprovals, setVenueShowcaseApproval, fetchOnlinePayments, setOnlinePayments, fetchWalkIns, setWalkIns,
  reactivateVenue, setReviewApproved, suspendVenue, updateLead, type Lead, type LeadStatus, type ReviewFilter,
  deletePlatformPaymentAccount, fetchPlatformPaymentAccounts, platformQrUrl, reorderPlatformPaymentAccounts, savePlatformPaymentAccount,
  type PlatformPaymentAccount,
} from './api'
import type { PaymentAccountInput, QrChange } from '../admin/api'

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

/** Invites a venue's staff member to set up their admin account (T24.2). */
export function useInviteVenueStaff() {
  return useMutation({ mutationFn: (input: { venueId: string; email: string }) => inviteVenueStaff(input) })
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

export function useWalkIns() {
  return useQuery({ queryKey: ['walk-ins'], queryFn: fetchWalkIns, refetchOnWindowFocus: true })
}

export function useSetWalkIns() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { venueId: string; enabled: boolean }) => setWalkIns(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['walk-ins'] }),
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

/** Emails the invoice to the venue's owners (T26.6); the list and detail re-read, since a draft becomes sent. */
export function useSendInvoice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (invoiceId: string) => sendInvoice(invoiceId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['venues-overview'] }),
      ])
    },
  })
}

/** Fetches the invoice PDF for Preview PDF (T26.6). */
export function usePreviewInvoicePdf() {
  return useMutation({ mutationFn: (invoiceId: string) => fetchInvoicePdf(invoiceId) })
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

// Plotline's payment accounts (T26.5).
const platformAccountsKey = ['platform-payment-accounts'] as const

export function usePlatformPaymentAccounts() {
  return useQuery({ queryKey: platformAccountsKey, queryFn: fetchPlatformPaymentAccounts })
}

export function useSavePlatformPaymentAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ existing, input, qr }: { existing: PlatformPaymentAccount | null; input: PaymentAccountInput; qr: QrChange }) =>
      savePlatformPaymentAccount(existing, input, qr),
    onSettled: () => qc.invalidateQueries({ queryKey: platformAccountsKey }),
  })
}

export function useDeletePlatformPaymentAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (account: PlatformPaymentAccount) => deletePlatformPaymentAccount(account),
    onSettled: () => qc.invalidateQueries({ queryKey: platformAccountsKey }),
  })
}

const REORDER_PLATFORM_ACCOUNTS_KEY = ['reorder-platform-payment-accounts'] as const

/** As the venue's useReorderPaymentAccounts: shown at once, saved one at a time; only the last pending save refreshes or rolls back. */
export function useReorderPlatformPaymentAccounts() {
  const qc = useQueryClient()
  const isLast = () => qc.isMutating({ mutationKey: REORDER_PLATFORM_ACCOUNTS_KEY }) <= 1
  return useMutation({
    mutationKey: REORDER_PLATFORM_ACCOUNTS_KEY,
    scope: { id: 'reorder-platform-payment-accounts' },
    mutationFn: (ids: string[]) => reorderPlatformPaymentAccounts(ids),
    onMutate: (ids) => {
      const previous = qc.getQueryData<PlatformPaymentAccount[]>(platformAccountsKey)
      if (previous) {
        const byId = new Map(previous.map((a) => [a.id, a]))
        qc.setQueryData(platformAccountsKey, ids.flatMap((id, i) => (byId.has(id) ? [{ ...byId.get(id)!, position: i }] : [])))
      }
      void qc.cancelQueries({ queryKey: platformAccountsKey }, { revert: false })
      return { previous }
    },
    onError: (_error, _ids, context) => {
      if (isLast() && context?.previous) qc.setQueryData(platformAccountsKey, context.previous)
    },
    onSettled: () => {
      if (isLast()) return qc.invalidateQueries({ queryKey: platformAccountsKey })
    },
  })
}

/** A signed URL for a private billing QR; refreshed well before its hour runs out. */
export function usePlatformQrUrl(path: string | null) {
  return useQuery({
    queryKey: ['platform-qr-url', path],
    queryFn: () => platformQrUrl(path!),
    enabled: path !== null,
    staleTime: 30 * 60 * 1000,
  })
}
