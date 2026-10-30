// Admin data access for bookings and payments. Admins read their venue's rows through RLS (private.is_venue_admin);
// writes go through RPCs (venue media: storage plus the admin RLS on courts and venue_settings). Only imported by lazy admin routes.
import type { PostgrestSingleResponse } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { ApiError, unwrap } from '../../lib/queryClient'
import { parseTstzRange } from '../../lib/time'
import type { Enums } from '../../lib/database.types'
import { currentAdminVenueId } from '../auth/api'
import { dayRangeLiteral, effectiveSort, parseSearch, type BookingFilters } from './bookingFilters'
import { VENUE_MEDIA_BUCKET } from '../catalog/media'
import type { CourtPhotoRow, VenueSettings } from '../catalog/api'
import type { OpenPlayInput } from '../openPlay/api'
import type { SocialPlatform } from '../venue/social'
import type { BookingChange } from './bookingAlerts'
import type { AmenityKey } from '../venue/amenities'
import { newMediaPath, storageErrorMessage } from './mediaInput'
import { qrStorageMessage } from './qrImage'
import { PAYMENT_QR_BUCKET } from '../venue/api'
import { clearStoredMedia, replaceStoredMedia } from './mediaReplace'

export type AdminPayment = {
  id: string
  method: Enums<'payment_method'>
  /** The payment account's label when paid with one (T11.27). */
  paid_with?: string | null
  amount: number
  reference_number: string | null
  storage_path: string | null
  submitted_at: string
  review_status: Enums<'payment_review_status'>
  review_note: string | null
  reviewed_at: string | null
  /** Null on an approved or rejected row means nobody reviewed it: recorded by PayMongo's webhook RPC. */
  reviewed_by: string | null
  /** PayMongo payment id (pay_…), for method 'paymongo'. */
  provider_payment_id: string | null
  /** How the customer paid on PayMongo (gcash, paymaya, card, qrph, …). */
  provider_source: string | null
}

export type AdminBooking = {
  id: string
  reference_code: string
  court_id: string
  court_name: string
  sport: Enums<'sport'> | null
  slot_start: string
  slot_end: string
  status: Enums<'booking_status'>
  source: Enums<'booking_source'>
  /** The court price. */
  total_amount: number
  /** Plotline's booking fee (T11.12) and what the player pays (court price + fee). */
  booking_fee: number
  amount_due: number
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
  /** Set on a moved part (T10.9): the booking it was split from. */
  parent_booking_id: string | null
}

export const adminKeys = {
  bookings: (filters: BookingFilters) => ['admin-bookings', filters] as const,
  allBookings: ['admin-bookings'] as const,
  proofUrl: (path: string) => ['proof-url', path] as const,
  proofQueue: ['admin-proof-queue'] as const,
  earnings: (from: string, to: string) => ['admin-earnings', from, to] as const,
  allEarnings: ['admin-earnings'] as const,
  allMovedParts: ['admin-moved-parts'] as const,
  movedParts: (bookingId: string) => ['admin-moved-parts', bookingId] as const,
}

// One literal: supabase-js infers the row type from this string.
const SELECT = 'id, reference_code, court_id, during, status, source, total_amount, booking_fee, amount_due, expires_at, rejection_count, guest_name, guest_email, guest_phone, created_at, cancelled_at, cancel_reason, cancelled_by_venue, parent_booking_id, courts(name, sport), payments(id, method, paid_with, amount, reference_number, storage_path, submitted_at, review_status, review_note, reviewed_at, reviewed_by, provider_payment_id, provider_source)' as const

export const ADMIN_LIST_LIMIT = 200

/**
 * The bookings list. Sorted on the server (effectiveSort: a day in time order, otherwise the latest play time first,
 * or as chosen; ties by id), so the 200-row cap keeps the most relevant rows. A search (T11.5b) looks through every
 * booking: the status, source and date filters are set aside while it's active.
 */
export async function fetchAdminBookings(
  filters: BookingFilters,
  timeZone: string,
): Promise<{ bookings: AdminBooking[]; truncated: boolean }> {
  const sort = effectiveSort(filters)
  const search = parseSearch(filters.q)
  let query = supabase
    .from('bookings')
    .select(SELECT)
    .order(sort.startsWith('play') ? 'during' : 'created_at', { ascending: sort.endsWith('asc') })
    .order('id')
    .limit(ADMIN_LIST_LIMIT + 1)
  if (search.kind === 'text') {
    query = query.or(search.filter)
  } else {
    if (filters.status !== 'all') query = query.eq('status', filters.status)
    if (filters.source !== 'all') query = query.eq('source', filters.source)
    if (filters.date) query = query.overlaps('during', dayRangeLiteral(filters.date, timeZone))
  }
  const all = unwrap(await query)
  const rows = all.slice(0, ADMIN_LIST_LIMIT)
  const bookings = rows.map((row) => {
    const { start, end } = parseTstzRange(row.during)
    return {
      id: row.id,
      reference_code: row.reference_code,
      court_id: row.court_id,
      court_name: row.courts?.name ?? 'Court',
      sport: row.courts?.sport ?? null,
      slot_start: start,
      slot_end: end,
      status: row.status,
      source: row.source,
      total_amount: Number(row.total_amount),
      booking_fee: Number(row.booking_fee),
      amount_due: Number(row.amount_due),
      expires_at: row.expires_at,
      rejection_count: row.rejection_count,
      guest_name: row.guest_name,
      guest_email: row.guest_email,
      guest_phone: row.guest_phone,
      created_at: row.created_at,
      cancelled_at: row.cancelled_at,
      cancel_reason: row.cancel_reason,
      cancelled_by_venue: row.cancelled_by_venue,
      parent_booking_id: row.parent_booking_id,
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
  if (error) throw new ApiError(storageErrorMessage(error))
  return data.signedUrl
}

export async function reviewPayment(bookingId: string, approve: boolean, note: string | null) {
  const rows = unwrap(await supabase.rpc('review_payment', { p_booking_id: bookingId, p_approve: approve, p_note: note ?? undefined }))
  return rows[0]?.status
}

/** Stores a sport's courts in this order, archived ones included (reorder_courts, T11.5a). */
export async function reorderCourts(sport: Enums<'sport'>, ids: string[]) {
  unwrap(await supabase.rpc('reorder_courts', { p_sport: sport, p_ids: ids }))
}

/** Staff cancel by booking id (the session path, so cancel_booking checks is_admin) with a required reason. */
export async function adminCancelBooking(bookingId: string, reason: string) {
  return unwrap(await supabase.rpc('cancel_booking', { p_booking_id: bookingId, p_reason: reason }))
}

export type Reschedule = {
  bookingId: string
  /** The booking's start for a whole move, or a later hour once it has begun (everything from it to the end moves). */
  fromStart: string
  courtId: string
  start: string
  reason: string
}

export type Rescheduled = {
  /** The booking created for the moved hours after a split; null when the whole booking moved. */
  continuationReference: string | null
}

/** reschedule_booking (T10.9): staff move a confirmed booking. The server re-checks every rule; the price never changes. */
export async function rescheduleBooking(input: Reschedule): Promise<Rescheduled> {
  const rows = unwrap(
    await supabase.rpc('reschedule_booking', {
      p_booking_id: input.bookingId,
      p_from_start: input.fromStart,
      p_new_court_id: input.courtId,
      p_new_start: input.start,
      p_reason: input.reason,
    }),
  )
  // The generated type says string, but a whole move has no continuation.
  return { continuationReference: rows[0]?.continuation_reference || null }
}

/** References of a booking's moved parts that are still booked: cancelling the booking doesn't cancel them (T10.1). */
export async function fetchActiveMovedParts(bookingId: string): Promise<string[]> {
  const rows = unwrap(
    await supabase
      .from('bookings')
      .select('reference_code')
      .eq('parent_booking_id', bookingId)
      .eq('status', 'confirmed')
      .order('during'),
  )
  return rows.map((r) => r.reference_code)
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

/** PostgREST returns at most max_rows (1000) per request, so exports read page by page (RESEARCH M10). */
export const EXPORT_PAGE = 1000

async function allPages<T>(page: (from: number, to: number) => PromiseLike<PostgrestSingleResponse<T[]>>) {
  const rows: T[] = []
  for (let from = 0; ; from += EXPORT_PAGE) {
    const batch = unwrap(await page(from, from + EXPORT_PAGE - 1))
    rows.push(...batch)
    if (batch.length < EXPORT_PAGE) return rows
  }
}

export type ExportBooking = {
  reference_code: string
  /** Empty if the court can't be read (never invented). */
  court_name: string | null
  sport: Enums<'sport'> | null
  slot_start: string
  slot_end: string
  status: Enums<'booking_status'>
  source: Enums<'booking_source'>
  expires_at: string | null
  guest_name: string
  guest_phone: string | null
  guest_email: string | null
  total_amount: number
  booking_fee: number
  amount_due: number
}

/** Every booking that starts in [startIso, endIso), by play time (T10.8). */
export async function fetchBookingsForExport(startIso: string, endIso: string): Promise<ExportBooking[]> {
  const rows = await allPages((from, to) => supabase
    .from('bookings')
    .select('reference_code, during, status, source, expires_at, guest_name, guest_phone, guest_email, total_amount, booking_fee, amount_due, courts(name, sport)')
    .overlaps('during', `[${startIso},${endIso})`)
    .order('during')
    .order('id')
    .range(from, to))
  const start = Date.parse(startIso)
  const end = Date.parse(endIso)
  return rows
    .map((row) => {
      const { start: slot_start, end: slot_end } = parseTstzRange(row.during)
      return {
        reference_code: row.reference_code,
        court_name: row.courts?.name ?? null,
        sport: row.courts?.sport ?? null,
        slot_start,
        slot_end,
        status: row.status,
        source: row.source,
        expires_at: row.expires_at,
        guest_name: row.guest_name,
        guest_phone: row.guest_phone,
        guest_email: row.guest_email,
        total_amount: Number(row.total_amount),
        booking_fee: Number(row.booking_fee),
        amount_due: Number(row.amount_due),
      }
    })
    // Overlapping isn't enough: a booking belongs to the range it starts in.
    .filter((b) => Date.parse(b.slot_start) >= start && Date.parse(b.slot_start) < end)
}

export type ExportPayment = {
  booking_reference: string
  method: Enums<'payment_method'>
  paid_with?: string | null
  amount: number
  reference_number: string | null
  received_at: string | null
  review_status: Enums<'payment_review_status'>
}

/** Money that came in during [startIso, endIso): accepted payments, and PayMongo payments to refund (T10.8). */
export async function fetchPaymentsForExport(startIso: string, endIso: string): Promise<ExportPayment[]> {
  const rows = await allPages((from, to) => supabase
    .from('payments')
    .select('method, paid_with, amount, reference_number, reviewed_at, review_status, bookings(reference_code)')
    .or('review_status.eq.approved,and(method.eq.paymongo,review_status.eq.rejected)')
    .gte('reviewed_at', startIso)
    .lt('reviewed_at', endIso)
    .order('reviewed_at')
    .order('id')
    .range(from, to))
  return rows.map((row) => ({
    booking_reference: row.bookings?.reference_code ?? '',
    method: row.method,
    paid_with: row.paid_with,
    amount: Number(row.amount),
    reference_number: row.reference_number,
    received_at: row.reviewed_at,
    review_status: row.review_status,
  }))
}

/** The earnings summary for venue dates from–to, inclusive (T10.6): raw JSON, read with parseEarnings. */
export async function fetchEarnings(from: string, to: string) {
  return unwrap(await supabase.rpc('get_earnings', { p_from: from, p_to: to }))
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

/** The admin's venue (their membership, T12.10): new uploads go under `{venue_id}/…`, which the storage policies check (T12.7). */
const venueFolder = currentAdminVenueId

async function uploadVenueMedia(folder: string, image: Blob) {
  const path = newMediaPath(`${await venueFolder()}/${folder}`, image.type)
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

/**
 * Deletes a court that was never booked (delete_court refuses otherwise, hint `court_has_bookings`), then removes
 * every file under its media folder. The file cleanup is best effort: a leftover file is an orphan the RESEARCH M6
 * query lists, never a broken link, so it doesn't fail the delete.
 */
export async function deleteCourt(courtId: string) {
  unwrap(await supabase.rpc('delete_court', { p_court_id: courtId }))
  await removeMediaFolder(`${await venueFolder()}/courts/${courtId}`).catch(() => {})
}

async function removeMediaFolder(folder: string) {
  const { data: files, error } = await supabase.storage.from(VENUE_MEDIA_BUCKET).list(folder, { limit: 100 })
  if (error) throw new ApiError(storageErrorMessage(error))
  if (!files?.length) return
  const { error: removeError } = await supabase.storage.from(VENUE_MEDIA_BUCKET).remove(files.map((f) => `${folder}/${f.name}`))
  if (removeError) throw new ApiError(storageErrorMessage(removeError))
}

// --- court photos (T9.7; the old courts.photo_path column was dropped in T9.11) ------------------------------

/**
 * Uploads an already downscaled image and adds it to the court's gallery at `sortOrder` (the caller passes
 * one past the last photo). If the row can't be saved, the uploaded file is removed again.
 */
export async function addCourtPhoto(courtId: string, image: Blob, sortOrder: number): Promise<CourtPhotoRow> {
  const path = await uploadVenueMedia(`courts/${courtId}`, image)
  try {
    return unwrap(
      await supabase.from('court_photos').insert({ venue_id: await currentAdminVenueId(), court_id: courtId, path, sort_order: sortOrder })
        .select('id, path, sort_order').single(),
    )
  } catch (error) {
    await removeVenueMedia(path).catch(() => {})
    throw error
  }
}

/** Removes the row first, then the file (best effort): a row never points at a missing file (RESEARCH M6). */
export async function removeCourtPhoto(photo: Pick<CourtPhotoRow, 'id' | 'path'>) {
  unwrap(await supabase.from('court_photos').delete().eq('id', photo.id))
  await removeVenueMedia(photo.path).catch(() => {})
}

/** Stores the court's photos in this order; the first is the cover (reorder_court_photos, SPEC §6). */
export async function reorderCourtPhotos(courtId: string, ids: string[]) {
  unwrap(await supabase.rpc('reorder_court_photos', { p_court_id: courtId, p_ids: ids }))
}

async function updateBanner(values: Pick<VenueSettings, 'banner_path' | 'banner_alt'> | Pick<VenueSettings, 'banner_alt'>) {
  return unwrap(await supabase.from('venue_settings').update(values).eq('venue_id', await currentAdminVenueId()).select().single())
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

// --- Open play sessions (T9.11d; the RPCs check every rule) ---------------------

/** Creates a session (id null) or replaces one that hasn't started. Returns its id. */
export async function saveOpenPlay(id: string | null, input: OpenPlayInput): Promise<string> {
  const args = {
    p_court_ids: input.courtIds,
    p_start: input.start,
    p_end: input.end,
    p_title: input.title,
    p_details: input.details,
    p_links: input.links,
  }
  return id
    ? unwrap(await supabase.rpc('update_open_play', { p_id: id, ...args }))
    : unwrap(await supabase.rpc('create_open_play', args))
}

export async function deleteOpenPlay(id: string) {
  unwrap(await supabase.rpc('delete_open_play', { p_id: id }))
}

// --- Venue info (T9.11h; admin RLS on the tables, plus reorder_info_sections) --------

/** Saves every platform at once: a URL upserts, an empty one removes that platform's link. */
export async function saveSocialLinks(links: Record<SocialPlatform, string>) {
  const entries = Object.entries(links) as [SocialPlatform, string][]
  const venue_id = await currentAdminVenueId()
  const upserts = entries.filter(([, url]) => url).map(([platform, url]) => ({ venue_id, platform, url }))
  const removed = entries.filter(([, url]) => !url).map(([platform]) => platform)
  if (upserts.length) unwrap(await supabase.from('venue_social_links').upsert(upserts))
  if (removed.length) unwrap(await supabase.from('venue_social_links').delete().eq('venue_id', venue_id).in('platform', removed))
}

export type InfoSectionInput = { title: string; body: string }

/** Creates a section (it goes last) or updates one. */
export async function saveInfoSection(id: string | null, input: InfoSectionInput) {
  const query = id
    ? supabase.from('venue_info_sections').update(input).eq('id', id).select('id').single()
    : supabase.from('venue_info_sections').insert({ ...input, venue_id: await currentAdminVenueId() }).select('id').single()
  return unwrap(await query)
}

export async function deleteInfoSection(id: string) {
  unwrap(await supabase.from('venue_info_sections').delete().eq('id', id))
}

/** Stores every info section in this order (reorder_info_sections, T11.5a). */
export async function reorderInfoSections(ids: string[]) {
  unwrap(await supabase.rpc('reorder_info_sections', { p_ids: ids }))
}

/** Switches a built-in amenity on (a row) or off (no row). */
export async function setBuiltinAmenity(key: AmenityKey, on: boolean) {
  const venue_id = await currentAdminVenueId()
  unwrap(on
    ? await supabase.from('venue_amenities').insert({ venue_id, builtin_key: key })
    : await supabase.from('venue_amenities').delete().eq('venue_id', venue_id).eq('builtin_key', key))
}

export async function addCustomAmenity(name: string) {
  unwrap(await supabase.from('venue_amenities').insert({ venue_id: await currentAdminVenueId(), custom_name: name }))
}

export async function removeAmenity(id: string) {
  unwrap(await supabase.from('venue_amenities').delete().eq('id', id))
}

// --- payment accounts and their QR codes (T11.11; the public `payment-qr` bucket, admin-only writes) ---------------

export type PaymentAccountInput = { label: string; account_name: string; account_number: string }
/** What happens to an account's QR code on save. */
export type QrChange = { kind: 'keep' } | { kind: 'set'; image: Blob } | { kind: 'clear' }

async function uploadPaymentQr(image: Blob) {
  const path = `${await venueFolder()}/${crypto.randomUUID()}.png`
  const { error } = await supabase.storage
    .from(PAYMENT_QR_BUCKET)
    .upload(path, image, { contentType: 'image/png', cacheControl: '31536000', upsert: false })
  if (error) throw new ApiError(qrStorageMessage(error))
  return path
}

async function removePaymentQr(path: string) {
  const { data, error } = await supabase.storage.from(PAYMENT_QR_BUCKET).remove([path])
  if (error) throw new ApiError(qrStorageMessage(error))
  if (!data?.length) throw new ApiError(`The file ${path} was not deleted.`)
}

/**
 * Adds an account (it goes last) or updates one. A new QR is uploaded first and saved after; a replaced or cleared
 * one is removed after the row is saved (best effort), so a row never points at a missing image. `position` is never
 * sent: only reorder_payment_accounts sets it.
 */
export async function savePaymentAccount(existing: { id: string; qr_path: string | null } | null, input: PaymentAccountInput, qr: QrChange) {
  const insert = async (qr_path: string | null) =>
    unwrap(await supabase.from('venue_payment_accounts').insert({ ...input, qr_path, venue_id: await currentAdminVenueId() }).select('id').single())
  const update = async (patch: { qr_path?: string | null }) =>
    unwrap(await supabase.from('venue_payment_accounts').update({ ...input, ...patch }).eq('id', existing!.id).select('id').single())

  if (!existing) {
    if (qr.kind !== 'set') return insert(null)
    return replaceStoredMedia({ oldPath: null, upload: () => uploadPaymentQr(qr.image), save: insert, remove: removePaymentQr })
  }
  if (qr.kind === 'set') {
    return replaceStoredMedia({
      oldPath: existing.qr_path, upload: () => uploadPaymentQr(qr.image), save: (qr_path) => update({ qr_path }), remove: removePaymentQr,
    })
  }
  if (qr.kind === 'clear' && existing.qr_path) {
    return clearStoredMedia({ oldPath: existing.qr_path, save: () => update({ qr_path: null }), remove: removePaymentQr })
  }
  return update({})
}

/** Deletes the account, then its QR image (best effort: a leftover file is an orphan, never a broken link). */
export async function deletePaymentAccount(account: { id: string; qr_path: string | null }) {
  unwrap(await supabase.from('venue_payment_accounts').delete().eq('id', account.id))
  if (account.qr_path) await removePaymentQr(account.qr_path).catch(() => {})
}

/** Stores every account in this order (reorder_payment_accounts, T11.10). */
export async function reorderPaymentAccounts(ids: string[]) {
  unwrap(await supabase.rpc('reorder_payment_accounts', { p_ids: ids }))
}

/**
 * Booking changes for open admin tabs (T11.21): the private Realtime topic admin:bookings:{venueId} (T12.11), which
 * only that venue's admins can join (RLS on realtime.messages). onReconnect runs when the channel comes back after a drop, so lists are refetched
 * in case an event was missed. Returns the unsubscribe.
 */
export function subscribeToBookingChanges({ onChange, onReconnect }: { onChange: (change: BookingChange) => void; onReconnect: () => void }) {
  let dropped = false
  let channel: ReturnType<typeof supabase.channel> | null = null
  let closed = false
  // The private channel is authorized with the user's JWT, which Realtime must have before joining.
  void Promise.all([currentAdminVenueId(), supabase.realtime.setAuth()]).then(([venueId]) => {
    if (closed) return
    channel = supabase
      .channel(`admin:bookings:${venueId}`, { config: { private: true } })
      .on('broadcast', { event: 'booking_changed' }, ({ payload }) => onChange(payload as BookingChange))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (dropped) onReconnect()
          dropped = false
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          dropped = true
        }
      })
  }).catch((e) => {
    // No venue or no Realtime auth: the admin lists still load and refetch, they just aren't live.
    console.error('Live booking changes are off', e)
  })
  return () => {
    closed = true
    if (channel) void supabase.removeChannel(channel)
  }
}
