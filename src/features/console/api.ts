import { FunctionsHttpError } from '@supabase/supabase-js'
import type { Database, Tables } from '../../lib/database.types'
import { ApiError, unwrap } from '../../lib/queryClient'
import { supabase } from '../../lib/supabase'
import type { PaymentAccountInput, QrChange } from '../admin/api'
import { clearStoredMedia, replaceStoredMedia } from '../admin/mediaReplace'
import { qrStorageMessage } from '../admin/qrImage'

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

/** Invokes a platform Edge Function; a refusal becomes ApiError(message, status, code) from its JSON body. */
async function invokeConsoleFunction<T>(name: string, body: Record<string, unknown>, fallback: string): Promise<T | null> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response
      const parsed = (await response.json().catch(() => null)) as { code?: string; message?: string } | null
      throw new ApiError(parsed?.message ?? fallback, String(response.status), parsed?.code)
    }
    throw new ApiError('Could not reach the server. Please check your connection and try again.')
  }
  return data as T | null
}

function callInviteVenueOwner(input: { venueId: string; email: string; role?: 'staff' }) {
  const body: Record<string, unknown> = { venue_id: input.venueId, email: input.email }
  if (input.role) body.role = input.role
  return invokeConsoleFunction<{ invited?: unknown; sent?: unknown }>('invite-venue-owner', body, "We couldn't send the invite.")
}

/** Invites the venue's first owner through the `invite-venue-owner` function (platform admins only). */
export async function inviteVenueOwner(input: { venueId: string; email: string }): Promise<{ invited: boolean }> {
  return { invited: (await callInviteVenueOwner(input))?.invited === true }
}

/**
 * What the function emailed (T17.25): an account-setup invitation (no account), a fresh access link (invited, no
 * password yet) or a welcome email with the venue's sign-in link (the account already signs in).
 */
export type OwnerInviteSent = 'invite' | 'link' | 'welcome'

/** Re-sends a venue's owner a way in (T14.5d): the first invite can be used up, expired or never delivered. */
export async function resendOwnerInvite(input: { venueId: string; email: string }): Promise<{ sent: OwnerInviteSent }> {
  return sentOf(await callInviteVenueOwner(input))
}

/** Invites a venue's staff member (T24.2): `invite-venue-owner` with `role: 'staff'`, which never demotes an owner. */
export async function inviteVenueStaff(input: { venueId: string; email: string }): Promise<{ sent: OwnerInviteSent }> {
  return sentOf(await callInviteVenueOwner({ ...input, role: 'staff' }))
}

function sentOf(data: { sent?: unknown } | null): { sent: OwnerInviteSent } {
  const sent = data?.sent
  if (sent === 'invite' || sent === 'link' || sent === 'welcome') return { sent }
  throw new ApiError("We couldn't send the invite.")
}

/** Deletes one lead and its notes (T17.26; platform admins only). A venue created from it is kept. */
export async function deleteLead(leadId: string): Promise<void> {
  unwrap(await supabase.rpc('delete_lead', { p_lead_id: leadId }))
}

/** Why a venue cannot be deleted, in the database's order (T17.26). */
export type VenueDeletionBlocker = 'protected' | 'bookings' | 'payments' | 'checkouts' | 'charges' | 'invoices' | 'open_play'

export type VenueDeletionPreview = {
  slug: string
  deletable: boolean
  blockers: VenueDeletionBlocker[]
  counts: { bookings: number; payments: number; checkouts: number; charges: number; invoices: number; open_play_sessions: number; courts: number; members: number }
}

/** What deleting a venue would remove, or why it can't be deleted (platform admins only). */
export async function fetchVenueDeletionPreview(venueId: string): Promise<VenueDeletionPreview> {
  return unwrap(await supabase.rpc('venue_deletion_preview', { p_venue_id: venueId })) as unknown as VenueDeletionPreview
}

/** `pending`: the venue is deleted but some of its files are not confirmed removed yet (retry with retryVenueFileCleanup). */
export type VenueCleanup = 'done' | 'pending'

function cleanupOf(data: { cleanup?: unknown } | null): { cleanup: VenueCleanup } {
  return { cleanup: data?.cleanup === 'done' ? 'done' : 'pending' }
}

/** Deletes an unused venue and its files through the `delete-unused-venue` function (T17.27). */
export async function deleteUnusedVenue(input: { venueId: string; confirmSlug: string }): Promise<{ cleanup: VenueCleanup }> {
  return cleanupOf(await invokeConsoleFunction<{ cleanup?: unknown }>(
    'delete-unused-venue', { action: 'delete', venue_id: input.venueId, confirm_slug: input.confirmSlug }, "We couldn't delete the venue."))
}

/** Retries the file cleanup of a deleted venue. */
export async function retryVenueFileCleanup(venueId: string): Promise<{ cleanup: VenueCleanup }> {
  return cleanupOf(await invokeConsoleFunction<{ cleanup?: unknown }>(
    'delete-unused-venue', { action: 'retry', venue_id: venueId }, "We couldn't finish the file cleanup."))
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

export type OnlinePaymentsRow = Pick<Tables<'venue_settings'>, 'venue_id' | 'online_payments_enabled'>

/** Every venue's online payments switch in one request (T18.2), separate from the overview like Showcase approval. */
export async function fetchOnlinePayments(): Promise<OnlinePaymentsRow[]> {
  return unwrap(await supabase.from('venue_settings').select('venue_id, online_payments_enabled'))
}

export async function setOnlinePayments(input: { venueId: string; enabled: boolean }): Promise<void> {
  unwrap(await supabase.rpc('set_online_payments', { p_venue_id: input.venueId, p_enabled: input.enabled }))
}

export type WalkInsRow = Pick<Tables<'venue_settings'>, 'venue_id' | 'walk_ins_enabled'>

/** Every venue's walk-ins switch in one request (T18.4), read like the online payments switch. */
export async function fetchWalkIns(): Promise<WalkInsRow[]> {
  return unwrap(await supabase.from('venue_settings').select('venue_id, walk_ins_enabled'))
}

export async function setWalkIns(input: { venueId: string; enabled: boolean }): Promise<void> {
  unwrap(await supabase.rpc('set_walk_ins', { p_venue_id: input.venueId, p_enabled: input.enabled }))
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

/** Console lists show 25 records per page (T17.18). Pages are 1-based. */
export const CONSOLE_PAGE_SIZE = 25

export type Page<T> = { rows: T[]; total: number }

type Functions = Database['public']['Functions']

function offsetOf(page: number): number {
  return (Math.max(1, Math.floor(page)) - 1) * CONSOLE_PAGE_SIZE
}

/** Blank filters are sent as SQL null ("no filter"). The generated Args type omits null for defaulted arguments. */
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

function asPage<T>(data: unknown): Page<T> {
  const body = (data ?? {}) as { rows?: unknown; total?: unknown }
  return { rows: (Array.isArray(body.rows) ? body.rows : []) as T[], total: Number(body.total ?? 0) }
}

/**
 * A PostgREST `or=(...)` filter matching `term` as a literal, case-insensitive substring of any column. LIKE wildcards
 * and the backslash are escaped for LIKE, then the whole value is double-quoted (escaping `\` and `"` once more) so
 * commas, dots and parentheses in the term cannot change the filter. Null for a blank term.
 */
function substringFilter(columns: string[], term: string): string | null {
  const trimmed = term.trim()
  if (trimmed === '') return null
  const like = `%${trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const quoted = `"${like.replace(/[\\"]/g, (c) => `\\${c}`)}"`
  return columns.map((column) => `${column}.ilike.${quoted}`).join(',')
}

export async function fetchVenuesPage(input: { search: string; status: string; page: number }): Promise<Page<VenueOverview>> {
  const args = { p_search: blankToNull(input.search), p_status: blankToNull(input.status), p_limit: CONSOLE_PAGE_SIZE, p_offset: offsetOf(input.page) }
  return asPage<VenueOverview>(unwrap(await supabase.rpc('venues_page', args as Functions['venues_page']['Args'])))
}

export async function fetchInvoicesPage(input: { search: string; status: string; month: string; page: number }): Promise<Page<InvoiceOverview>> {
  const args = {
    p_search: blankToNull(input.search),
    p_status: blankToNull(input.status),
    p_month: blankToNull(input.month),
    p_limit: CONSOLE_PAGE_SIZE,
    p_offset: offsetOf(input.page),
  }
  return asPage<InvoiceOverview>(unwrap(await supabase.rpc('invoices_page', args as Functions['invoices_page']['Args'])))
}

export type InvoiceDetailPageData = InvoiceDetailData & { line_total: number }

/** One invoice with one page of its lines; `line_total` counts every line. */
export async function fetchInvoiceDetailPage(input: { invoiceId: string; page: number }): Promise<InvoiceDetailPageData> {
  return unwrap(
    await supabase.rpc('invoice_detail_page', { p_invoice_id: input.invoiceId, p_limit: CONSOLE_PAGE_SIZE, p_offset: offsetOf(input.page) }),
  ) as unknown as InvoiceDetailPageData
}

/** One bounded page of leads, newest first (id breaks ties), with the exact count of all matching leads. */
export async function fetchLeadsPage(input: { status: LeadStatus | 'all'; search: string; page: number }): Promise<Page<Lead>> {
  const from = offsetOf(input.page)
  let query = supabase.from('leads').select('*', { count: 'exact' })
  if (input.status !== 'all') query = query.eq('status', input.status)
  const search = substringFilter(['first_name', 'last_name', 'email', 'venue_name'], input.search)
  if (search) query = query.or(search)
  const res = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, from + CONSOLE_PAGE_SIZE - 1)
  return { rows: unwrap(res), total: res.count ?? 0 }
}

export type ReviewFilter = 'all' | 'approved' | 'hidden'

/** One bounded page of reviews, newest first (id breaks ties), with the exact count of all matching reviews. */
export async function fetchReviewsPage(input: { approved: ReviewFilter; search: string; page: number }): Promise<Page<Review>> {
  const from = offsetOf(input.page)
  let query = supabase.from('reviews').select('*', { count: 'exact' })
  if (input.approved !== 'all') query = query.eq('approved', input.approved === 'approved')
  const search = substringFilter(['name', 'venue', 'quote'], input.search)
  if (search) query = query.or(search)
  const res = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, from + CONSOLE_PAGE_SIZE - 1)
  return { rows: unwrap(res), total: res.count ?? 0 }
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

// --- Plotline's payment accounts (T26.5): shown on every invoice PDF; the QR images live in the private
// platform-billing bucket at a top-level `<uuid>.png` (T26.3's storage policy). Platform admins only (RLS).

export type PlatformPaymentAccount = Pick<Tables<'platform_payment_accounts'>, 'id' | 'label' | 'account_name' | 'account_number' | 'qr_path' | 'position'>
export const PLATFORM_BILLING_BUCKET = 'platform-billing'

export async function fetchPlatformPaymentAccounts(): Promise<PlatformPaymentAccount[]> {
  return unwrap(await supabase.from('platform_payment_accounts')
    .select('id, label, account_name, account_number, qr_path, position').order('position'))
}

async function uploadPlatformQr(image: Blob) {
  const path = `${crypto.randomUUID()}.png`
  const { error } = await supabase.storage
    .from(PLATFORM_BILLING_BUCKET)
    .upload(path, image, { contentType: 'image/png', upsert: false })
  if (error) throw new ApiError(qrStorageMessage(error))
  return path
}

async function removePlatformQr(path: string) {
  const { data, error } = await supabase.storage.from(PLATFORM_BILLING_BUCKET).remove([path])
  if (error) throw new ApiError(qrStorageMessage(error))
  if (!data?.length) throw new ApiError(`The file ${path} was not deleted.`)
}

/** As the venue's savePaymentAccount: a new QR is uploaded before the row is saved, an old one removed after. `position` is never sent. */
export async function savePlatformPaymentAccount(
  existing: { id: string; qr_path: string | null } | null, input: PaymentAccountInput, qr: QrChange,
) {
  const insert = async (qr_path: string | null) =>
    unwrap(await supabase.from('platform_payment_accounts').insert({ ...input, qr_path }).select('id').single())
  const update = async (patch: { qr_path?: string | null }) =>
    unwrap(await supabase.from('platform_payment_accounts').update({ ...input, ...patch }).eq('id', existing!.id).select('id').single())

  if (!existing) {
    if (qr.kind !== 'set') return insert(null)
    return replaceStoredMedia({ oldPath: null, upload: () => uploadPlatformQr(qr.image), save: insert, remove: removePlatformQr })
  }
  if (qr.kind === 'set') {
    return replaceStoredMedia({
      oldPath: existing.qr_path, upload: () => uploadPlatformQr(qr.image), save: (qr_path) => update({ qr_path }), remove: removePlatformQr,
    })
  }
  if (qr.kind === 'clear' && existing.qr_path) {
    return clearStoredMedia({ oldPath: existing.qr_path, save: () => update({ qr_path: null }), remove: removePlatformQr })
  }
  return update({})
}

/** Deletes the account, then its QR image (best effort). */
export async function deletePlatformPaymentAccount(account: { id: string; qr_path: string | null }) {
  unwrap(await supabase.from('platform_payment_accounts').delete().eq('id', account.id))
  if (account.qr_path) await removePlatformQr(account.qr_path).catch(() => {})
}

/** Stores every account in this order (reorder_platform_payment_accounts, T26.3). */
export async function reorderPlatformPaymentAccounts(ids: string[]) {
  unwrap(await supabase.rpc('reorder_platform_payment_accounts', { p_ids: ids }))
}

/** A one-hour signed URL for a QR image (the bucket is private). */
export async function platformQrUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(PLATFORM_BILLING_BUCKET).createSignedUrl(path, 3600)
  if (error || !data) throw new ApiError("The QR image couldn't be loaded.")
  return data.signedUrl
}
