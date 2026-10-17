// Admin data access for bookings and payments. Admins read everything through RLS (private.is_admin());
// writes go through RPCs. Only imported by lazy admin routes.
import { supabase } from '../../lib/supabase'
import { ApiError, unwrap } from '../../lib/queryClient'
import { parseTstzRange } from '../../lib/time'
import type { Enums } from '../../lib/database.types'
import { dayRangeLiteral, type BookingFilters } from './bookingFilters'

export type AdminPayment = {
  id: string
  method: Enums<'payment_method'>
  amount: number
  reference_number: string | null
  storage_path: string | null
  submitted_at: string
  review_status: Enums<'payment_review_status'>
  review_note: string | null
}

export type AdminBooking = {
  id: string
  reference_code: string
  court_name: string
  slot_start: string
  slot_end: string
  status: Enums<'booking_status'>
  source: Enums<'booking_source'>
  total_amount: number
  expires_at: string | null
  rejection_count: number
  guest_name: string
  guest_email: string | null
  guest_phone: string | null
  created_at: string
  payments: AdminPayment[]
}

export const adminKeys = {
  bookings: (filters: BookingFilters) => ['admin-bookings', filters] as const,
  allBookings: ['admin-bookings'] as const,
  proofUrl: (path: string) => ['proof-url', path] as const,
  proofQueue: ['admin-proof-queue'] as const,
  takings: (from: string) => ['admin-takings', from] as const,
  allTakings: ['admin-takings'] as const,
}

// One literal: supabase-js infers the row type from this string.
const SELECT = 'id, reference_code, during, status, source, total_amount, expires_at, rejection_count, guest_name, guest_email, guest_phone, created_at, courts(name), payments(id, method, amount, reference_number, storage_path, submitted_at, review_status, review_note)' as const

export const ADMIN_LIST_LIMIT = 200

/** A day view reads in time order; otherwise the newest bookings come first so nothing recent is cut off. */
export async function fetchAdminBookings(
  filters: BookingFilters,
  timeZone: string,
): Promise<{ bookings: AdminBooking[]; truncated: boolean }> {
  let query = supabase
    .from('bookings')
    .select(SELECT)
    .order('during', { ascending: filters.date !== null })
    .limit(ADMIN_LIST_LIMIT + 1)
  if (filters.status !== 'all') query = query.eq('status', filters.status)
  if (filters.source !== 'all') query = query.eq('source', filters.source)
  if (filters.date) query = query.overlaps('during', dayRangeLiteral(filters.date, timeZone))
  const all = unwrap(await query)
  const rows = all.slice(0, ADMIN_LIST_LIMIT)
  const bookings = rows.map((row) => {
    const { start, end } = parseTstzRange(row.during)
    return {
      id: row.id,
      reference_code: row.reference_code,
      court_name: row.courts?.name ?? 'Court',
      slot_start: start,
      slot_end: end,
      status: row.status,
      source: row.source,
      total_amount: Number(row.total_amount),
      expires_at: row.expires_at,
      rejection_count: row.rejection_count,
      guest_name: row.guest_name,
      guest_email: row.guest_email,
      guest_phone: row.guest_phone,
      created_at: row.created_at,
      payments: [...row.payments]
        .map((p) => ({ ...p, amount: Number(p.amount) }))
        .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at)),
    }
  })
  return { bookings, truncated: all.length > ADMIN_LIST_LIMIT }
}

/** Short-lived link to a proof file; storage RLS allows admins (and the booking owner) to sign it. */
export async function fetchProofUrl(path: string) {
  const { data, error } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 60)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

export async function reviewPayment(bookingId: string, approve: boolean, note: string | null) {
  const rows = unwrap(await supabase.rpc('review_payment', { p_booking_id: bookingId, p_approve: approve, p_note: note ?? undefined }))
  return rows[0]?.status
}

/** The attempt waiting for review, if any (there is at most one: payments_one_pending_per_booking). */
export function pendingPayment(booking: Pick<AdminBooking, 'payments'>) {
  return booking.payments.find((p) => p.review_status === 'pending') ?? null
}

export async function fetchProofQueueCount() {
  const { count, error } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'payment_submitted')
  if (error) throw new ApiError(error.message, error.code)
  return count ?? 0
}

/** Approved payments reviewed (or recorded, for walk-ins) in [from, to). */
export async function fetchApprovedPayments(fromIso: string, toIso: string) {
  const rows = unwrap(
    await supabase
      .from('payments')
      .select('method, amount')
      .eq('review_status', 'approved')
      .gte('reviewed_at', fromIso)
      .lt('reviewed_at', toIso),
  )
  return rows.map((r) => ({ method: r.method, amount: Number(r.amount) }))
}

export type WalkInInput = {
  courtId: string
  start: string
  slots: number
  name: string
  phone: string
  method: Enums<'payment_method'>
  amount: number
  referenceNumber: string
}

export async function createWalkIn(input: WalkInInput) {
  const rows = unwrap(
    await supabase.rpc('create_walk_in', {
      p_court_id: input.courtId,
      p_start: input.start,
      p_slots: input.slots,
      p_name: input.name,
      p_phone: input.phone || undefined,
      p_method: input.method,
      p_amount: input.amount,
      p_reference_number: input.referenceNumber || undefined,
    }),
  )
  const row = rows[0]
  if (!row) throw new Error('The walk-in could not be recorded.')
  return { id: row.id, referenceCode: row.reference_code }
}
