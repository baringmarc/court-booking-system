import { FunctionsHttpError } from '@supabase/supabase-js'
import type { Tables } from '../../lib/database.types'
import { ApiError, unwrap } from '../../lib/queryClient'
import { supabase } from '../../lib/supabase'

/** Whether the user is a platform admin (RLS lets them read only their own `platform_admins` row). */
export async function fetchIsPlatformAdmin(userId: string): Promise<boolean> {
  const row = unwrap(await supabase.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle())
  return row !== null
}

export type Lead = Tables<'leads'>
export type LeadStatus = 'new' | 'talking' | 'won' | 'lost'

/** Leads, newest first. RLS lets only platform admins read them. */
export async function fetchLeads(status: LeadStatus | 'all'): Promise<Lead[]> {
  let query = supabase.from('leads').select('*').order('created_at', { ascending: false })
  if (status !== 'all') query = query.eq('status', status)
  return unwrap(await query)
}

/** Platform admins may change only `status` and `notes` (column grant). */
export async function updateLead(id: string, patch: { status?: LeadStatus; notes?: string | null }): Promise<void> {
  unwrap(await supabase.from('leads').update(patch).eq('id', id))
}

/** Creates a draft venue (platform admins only) and returns its id. Errors carry the RPC's hint, e.g. `slug_taken`. */
export async function createVenue(input: { slug: string; name: string; timezone: string }): Promise<string> {
  return unwrap(await supabase.rpc('create_venue', { p_slug: input.slug, p_name: input.name, p_timezone: input.timezone }))
}

async function callInviteVenueOwner(input: { venueId: string; email: string }): Promise<{ invited?: unknown; sent?: unknown } | null> {
  const { data, error } = await supabase.functions.invoke('invite-venue-owner', {
    body: { venue_id: input.venueId, email: input.email },
  })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response
      const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null
      throw new ApiError(body?.message ?? "We couldn't send the invite.", String(response.status), body?.code)
    }
    throw new ApiError('Could not reach the server. Please check your connection and try again.')
  }
  return data as { invited?: unknown; sent?: unknown } | null
}

/** Invites the venue's first owner through the `invite-venue-owner` function (platform admins only). */
export async function inviteVenueOwner(input: { venueId: string; email: string }): Promise<{ invited: boolean }> {
  return { invited: (await callInviteVenueOwner(input))?.invited === true }
}

/** What a resend did: a new invite, a fresh sign-in link for an invited owner, or nothing (the owner has a password). */
export type OwnerInviteSent = 'invite' | 'link' | 'none'

/** Re-sends a venue's owner a way in (T14.5d): the first invite can be used up, expired or never delivered. */
export async function resendOwnerInvite(input: { venueId: string; email: string }): Promise<{ sent: OwnerInviteSent }> {
  const body = await callInviteVenueOwner(input)
  return { sent: body?.sent === 'invite' || body?.sent === 'link' ? body.sent : 'none' }
}

export type VenueOverview = {
  venue_id: string
  slug: string
  name: string
  status: string
  month_transactions: number
  month_total: number
  open_invoices: number
}

/** Every venue with its status, this month's booking-fee count and total, and open invoices (platform admins only). */
export async function fetchVenuesOverview(): Promise<VenueOverview[]> {
  const rows = unwrap(await supabase.rpc('venues_overview'))
  return (Array.isArray(rows) ? rows : []) as VenueOverview[]
}

export type ShowcaseApproval = Pick<Tables<'venues'>, 'id' | 'showcase_approved'>

/** Separate from the overview so a failed approval read leaves other console actions available. */
export async function fetchShowcaseApprovals(): Promise<ShowcaseApproval[]> {
  return unwrap(await supabase.from('venues').select('id, showcase_approved'))
}

export async function setVenueShowcaseApproval(input: { venueId: string; approved: boolean }): Promise<void> {
  unwrap(await supabase.rpc('set_venue_showcase_approval', { p_venue_id: input.venueId, p_approved: input.approved }))
}

export async function suspendVenue(venueId: string): Promise<void> {
  unwrap(await supabase.rpc('suspend_venue', { p_venue_id: venueId }))
}

export async function reactivateVenue(venueId: string): Promise<void> {
  unwrap(await supabase.rpc('reactivate_venue', { p_venue_id: venueId }))
}

export type InvoiceOverview = {
  invoice_id: string
  venue_id: string
  slug: string
  name: string
  /** `YYYY-MM-01`. */
  billing_month: string
  status: 'draft' | 'sent' | 'paid'
  sent_at: string | null
  paid_at: string | null
  paid_method: string | null
  paid_reference: string | null
  fee_count: number
  fee_total: number
  /** Zero or negative. */
  adjustment_total: number
  total: number
  due_at: string | null
  overdue: boolean
}

export type InvoiceLine = {
  charge_id: string
  booking_id: string
  reference_code: string
  kind: 'booking_fee' | 'adjustment'
  amount: number
  charged_at: string
}

export type InvoiceDetailData = InvoiceOverview & { lines: InvoiceLine[] }

/** Every invoice, newest month first, with totals and the overdue flag (platform admins only). */
export async function fetchInvoicesOverview(): Promise<InvoiceOverview[]> {
  const rows = unwrap(await supabase.rpc('invoices_overview'))
  return (Array.isArray(rows) ? rows : []) as InvoiceOverview[]
}

export async function fetchInvoiceDetail(invoiceId: string): Promise<InvoiceDetailData> {
  return unwrap(await supabase.rpc('invoice_detail', { p_invoice_id: invoiceId })) as unknown as InvoiceDetailData
}

export async function markInvoiceSent(invoiceId: string): Promise<void> {
  unwrap(await supabase.rpc('mark_invoice_sent', { p_invoice_id: invoiceId }))
}

export async function markInvoicePaid(input: { invoiceId: string; method: string; reference: string }): Promise<void> {
  unwrap(await supabase.rpc('mark_invoice_paid', { p_invoice_id: input.invoiceId, p_method: input.method, p_reference: input.reference }))
}

export type Review = Tables<'reviews'>

/** Reviews from the marketing site, newest first. Platform admins see all of them (RLS). */
export async function fetchReviews(): Promise<Review[]> {
  return unwrap(await supabase.from('reviews').select('*').order('created_at', { ascending: false }))
}

/** Approving shows a review on the marketing site; hiding takes it down. Platform admins only (column grant). */
export async function setReviewApproved(id: string, approved: boolean): Promise<void> {
  unwrap(await supabase.from('reviews').update({ approved }).eq('id', id))
}
