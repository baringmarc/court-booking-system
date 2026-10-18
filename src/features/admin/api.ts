// Admin data access for bookings and payments. Admins read everything through RLS (private.is_admin());
// writes go through RPCs (venue media: storage plus the admin RLS on courts and venue_settings). Only imported by lazy admin routes.
import { supabase } from '../../lib/supabase'
import { ApiError, unwrap } from '../../lib/queryClient'
import { parseTstzRange } from '../../lib/time'
import type { Enums } from '../../lib/database.types'
import { dayRangeLiteral, type BookingFilters } from './bookingFilters'
import { VENUE_MEDIA_BUCKET } from '../catalog/media'
import type { Court, VenueSettings } from '../catalog/api'
import { newMediaPath, storageErrorMessage } from './mediaInput'
import { clearStoredMedia, replaceStoredMedia } from './mediaReplace'

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
  cancelled_at: string | null
  cancel_reason: string | null
  cancelled_by_venue: boolean
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
const SELECT = 'id, reference_code, during, status, source, total_amount, expires_at, rejection_count, guest_name, guest_email, guest_phone, created_at, cancelled_at, cancel_reason, cancelled_by_venue, courts(name), payments(id, method, amount, reference_number, storage_path, submitted_at, review_status, review_note)' as const

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
      cancelled_at: row.cancelled_at,
      cancel_reason: row.cancel_reason,
      cancelled_by_venue: row.cancelled_by_venue,
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

/** Staff cancel by booking id (the session path, so cancel_booking checks is_admin) with a required reason. */
export async function adminCancelBooking(bookingId: string, reason: string) {
  return unwrap(await supabase.rpc('cancel_booking', { p_booking_id: bookingId, p_reason: reason }))
}

/** A payment was approved: if the booking is cancelled, staff settle any refund outside the app (SPEC §4). */
export function hasApprovedPayment(booking: Pick<AdminBooking, 'payments'>) {
  return booking.payments.some((p) => p.review_status === 'approved')
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

// --- venue media (public `venue-media` bucket; admin-only writes via storage policies) ---------------

async function uploadVenueMedia(folder: string, image: Blob) {
  const path = newMediaPath(folder, image.type)
  // The path never changes contents, so it can be cached for a year (RESEARCH M6).
  const { error } = await supabase.storage
    .from(VENUE_MEDIA_BUCKET)
    .upload(path, image, { contentType: image.type, cacheControl: '31536000', upsert: false })
  if (error) throw new ApiError(storageErrorMessage(error))
  return path
}

/** remove() reports success without deleting when RLS hides the object, so check what came back. */
async function removeVenueMedia(path: string) {
  const { data, error } = await supabase.storage.from(VENUE_MEDIA_BUCKET).remove([path])
  if (error) throw new ApiError(storageErrorMessage(error))
  if (!data?.length) throw new ApiError(`The file ${path} was not deleted.`)
}

async function updateCourtPhotoPath(courtId: string, photoPath: string | null) {
  return unwrap(await supabase.from('courts').update({ photo_path: photoPath }).eq('id', courtId).select().single())
}

/** Uploads an already downscaled image as the court's photo, replacing any old one. */
export async function setCourtPhoto(court: Pick<Court, 'id' | 'photo_path'>, image: Blob) {
  return replaceStoredMedia({
    oldPath: court.photo_path,
    upload: () => uploadVenueMedia(`courts/${court.id}`, image),
    save: (path) => updateCourtPhotoPath(court.id, path),
    remove: removeVenueMedia,
  })
}

export async function removeCourtPhoto(court: Pick<Court, 'id' | 'photo_path'>) {
  if (!court.photo_path) return updateCourtPhotoPath(court.id, null)
  return clearStoredMedia({
    oldPath: court.photo_path,
    save: () => updateCourtPhotoPath(court.id, null),
    remove: removeVenueMedia,
  })
}

async function updateBanner(values: Pick<VenueSettings, 'banner_path' | 'banner_alt'> | Pick<VenueSettings, 'banner_alt'>) {
  return unwrap(await supabase.from('venue_settings').update(values).eq('id', true).select().single())
}

/** `alt` must already be trimmed (a CHECK enforces it). */
export type BannerInput = { alt: string; image?: Blob }

/**
 * Sets the site banner. With an image (already downscaled), uploads it and replaces any old banner;
 * without one, only updates the alt text of the current banner.
 */
export async function saveBanner(settings: Pick<VenueSettings, 'banner_path'>, { alt, image }: BannerInput) {
  if (!image) return updateBanner({ banner_alt: alt })
  return replaceStoredMedia({
    oldPath: settings.banner_path,
    upload: () => uploadVenueMedia('banner', image),
    save: (path) => updateBanner({ banner_path: path, banner_alt: alt }),
    remove: removeVenueMedia,
  })
}

export async function removeBanner(settings: Pick<VenueSettings, 'banner_path'>) {
  const clear = () => updateBanner({ banner_path: null, banner_alt: null })
  if (!settings.banner_path) return clear()
  return clearStoredMedia({ oldPath: settings.banner_path, save: clear, remove: removeVenueMedia })
}
