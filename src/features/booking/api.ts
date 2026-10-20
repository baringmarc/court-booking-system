import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { ApiError, unwrap } from '../../lib/queryClient'
import { parseTstzRange } from '../../lib/time'
import type { Enums } from '../../lib/database.types'
import type { Slot, SlotStatus } from './selection'
import type { BookingStatus } from './status'

export type { Slot } from './selection'

export type PaymentMethod = Enums<'payment_method'>
export type PaymentReviewStatus = Enums<'payment_review_status'>

/** One proof attempt as shown to the booking's owner or guest (never the file path). */
export type PaymentAttempt = {
  id: string
  method: PaymentMethod
  amount: number
  reference_number: string | null
  submitted_at: string
  review_status: PaymentReviewStatus
  reviewed_at: string | null
  review_note: string | null
}

const PAYMENT_FIELDS = 'id, method, amount, reference_number, submitted_at, review_status, reviewed_at, review_note'

function toPaymentAttempts(value: unknown): PaymentAttempt[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
    .map((p) => ({
      id: String(p.id),
      method: p.method as PaymentMethod,
      amount: Number(p.amount),
      reference_number: (p.reference_number as string | null) ?? null,
      submitted_at: String(p.submitted_at),
      review_status: p.review_status as PaymentReviewStatus,
      reviewed_at: (p.reviewed_at as string | null) ?? null,
      review_note: (p.review_note as string | null) ?? null,
    }))
    .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))
}

const SLOT_STATUSES = new Set<string>(['free', 'booked', 'blackout', 'past'])

/** One row per active court × slot on a venue-local date ("YYYY-MM-DD"). Empty for closed or out-of-window days. */
export async function fetchAvailability(date: string): Promise<Slot[]> {
  const rows = unwrap(await supabase.rpc('get_availability', { p_date: date }))
  return rows.map((r) => ({
    court_id: r.court_id,
    slot_start: r.slot_start,
    slot_end: r.slot_end,
    price: Number(r.price),
    // Unknown statuses are treated as unavailable rather than bookable.
    status: (SLOT_STATUSES.has(r.status) ? r.status : 'booked') as SlotStatus,
  }))
}

export type NewBooking = {
  courtId: string
  start: string
  slots: number
  /** Guests: required. Logged-in players: optional overrides of their profile name/phone. */
  contact?: { name?: string; email?: string; phone?: string }
}

export type CreatedBooking = { id: string; referenceCode: string; guestToken: string | null }

/** The price is never sent: the server computes it (SPEC §5.4). */
export async function createBooking({ courtId, start, slots, contact }: NewBooking): Promise<CreatedBooking> {
  const rows = unwrap(
    await supabase.rpc('create_booking', {
      p_court_id: courtId,
      p_start: start,
      p_slots: slots,
      p_guest_name: contact?.name,
      p_guest_email: contact?.email,
      p_guest_phone: contact?.phone,
    }),
  )
  const row = rows[0]
  if (!row) throw new Error('The booking could not be created. Please try again.')
  // The generated type says string, but players get null: guest tokens are for guests only.
  return { id: row.id, referenceCode: row.reference_code, guestToken: (row.guest_token as string | null) ?? null }
}

/** What the booking page shows, whether it was loaded by a guest token or by the owner through RLS. */
export type BookingDetail = {
  id: string
  reference_code: string
  court_id: string
  court_name: string
  sport: Enums<'sport'> | null
  slot_start: string
  slot_end: string
  status: BookingStatus
  total_amount: number
  expires_at: string | null
  rejection_count: number
  guest_name: string
  guest_email: string | null
  created_at: string
  payments: PaymentAttempt[]
  cancelled_at: string | null
  cancel_reason: string | null
  /** True when staff cancelled it (stored at cancel time). */
  cancelled_by_venue: boolean
  /** The owning account. Null for guest bookings, and on the guest path (get_guest_booking doesn't return it). */
  user_id: string | null
}

const notFound = () =>
  new ApiError('Booking not found. Check that you opened the full link from your confirmation.', 'P0001', 'not_found')

export async function fetchGuestBooking(referenceCode: string, token: string): Promise<BookingDetail> {
  const rows = unwrap(await supabase.rpc('get_guest_booking', { p_reference_code: referenceCode, p_token: token }))
  const row = rows[0]
  if (!row) throw notFound()
  return {
    id: row.id,
    reference_code: row.reference_code,
    court_id: row.court_id,
    court_name: row.court_name,
    sport: row.sport,
    slot_start: row.slot_start,
    slot_end: row.slot_end,
    status: row.status,
    total_amount: Number(row.total_amount),
    expires_at: row.expires_at,
    rejection_count: row.rejection_count,
    guest_name: row.guest_name,
    guest_email: row.guest_email,
    created_at: row.created_at,
    payments: toPaymentAttempts(row.payments),
    cancelled_at: row.cancelled_at,
    cancel_reason: row.cancel_reason,
    cancelled_by_venue: row.cancelled_by_venue,
    user_id: null,
  }
}

/** Owners and admins read their bookings through RLS. */
export async function fetchOwnBooking(referenceCode: string): Promise<BookingDetail> {
  const row = unwrap(
    await supabase
      .from('bookings')
      .select(`id, reference_code, court_id, user_id, during, status, total_amount, expires_at, rejection_count, guest_name, guest_email, created_at, cancelled_at, cancel_reason, cancelled_by_venue, courts(name, sport), payments(${PAYMENT_FIELDS})`)
      .eq('reference_code', referenceCode.trim().toUpperCase())
      .maybeSingle(),
  )
  if (!row) throw notFound()
  const { start, end } = parseTstzRange(row.during)
  return {
    id: row.id,
    reference_code: row.reference_code,
    court_id: row.court_id,
    // Archived courts are hidden from players by RLS, so the join can be empty.
    court_name: row.courts?.name ?? 'Court',
    sport: row.courts?.sport ?? null,
    slot_start: start,
    slot_end: end,
    status: row.status,
    total_amount: Number(row.total_amount),
    expires_at: row.expires_at,
    rejection_count: row.rejection_count,
    guest_name: row.guest_name,
    guest_email: row.guest_email,
    created_at: row.created_at,
    payments: toPaymentAttempts(row.payments),
    cancelled_at: row.cancelled_at,
    cancel_reason: row.cancel_reason,
    cancelled_by_venue: row.cancelled_by_venue,
    user_id: row.user_id,
  }
}

export type Cancellation = {
  bookingId: string
  referenceCode: string
  /** Guests cancel with their link's token; signed-in owners by their session. */
  token: string | null
  reason: string
}

/** cancel_booking (SPEC §4). The guest path never grants admin rights, so owners without a token use the id. */
export async function cancelBooking(input: Cancellation): Promise<void> {
  const reason = input.reason.trim() || undefined
  const args = input.token !== null
    ? { p_reference_code: input.referenceCode, p_token: input.token, p_reason: reason }
    : { p_booking_id: input.bookingId, p_reason: reason }
  unwrap(await supabase.rpc('cancel_booking', args))
}

export type ProofSubmission = {
  referenceCode: string
  /** Guests only; signed-in owners are identified by their session. */
  token: string | null
  method: Exclude<PaymentMethod, 'cash'>
  amount: number
  referenceNumber: string
  file: File
}

/** Sends the proof to the submit-payment-proof Edge Function (multipart). Errors come back as ApiError with a hint code. */
export async function submitPaymentProof(input: ProofSubmission): Promise<void> {
  const form = new FormData()
  form.append('reference_code', input.referenceCode)
  if (input.token) form.append('token', input.token)
  form.append('method', input.method)
  form.append('amount', String(input.amount))
  if (input.referenceNumber.trim()) form.append('reference_number', input.referenceNumber.trim())
  form.append('file', input.file)

  const { error } = await supabase.functions.invoke('submit-payment-proof', { body: form })
  if (error) throw await functionError(error, 'The proof could not be submitted.')
}

/**
 * Asks for the guest's booking email with their private link (SPEC §8). The token goes in the request body, like proof
 * uploads, never in a URL. A failure is harmless: the email is still sent later, without the link.
 */
export async function requestGuestLinkEmail(input: { referenceCode: string; token: string }): Promise<void> {
  const { error } = await supabase.functions.invoke('email-guest-link', {
    body: { reference_code: input.referenceCode, token: input.token },
  })
  if (error) throw await functionError(error, "We couldn't send the booking email.")
}

/** Edge Function errors come back as `{ code, message }`; turn them into ApiError with the code as hint. */
async function functionError(error: unknown, fallback: string) {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null
    return new ApiError(body?.message ?? fallback, String(response.status), body?.code)
  }
  return new ApiError('Could not reach the server. Please check your connection and try again.')
}

/**
 * Starts (or resumes) a PayMongo test-mode checkout through the create-paymongo-checkout Edge Function and returns
 * the hosted checkout URL. The amount is the stored total; guests send their token, owners rely on their session.
 */
export async function startPaymongoCheckout(input: { referenceCode: string; token: string | null }): Promise<string> {
  const { data, error } = await supabase.functions.invoke('create-paymongo-checkout', {
    body: { reference_code: input.referenceCode, ...(input.token ? { token: input.token } : {}) },
  })
  if (error) throw await functionError(error, "We couldn't start the online payment.")
  const url = (data as { checkout_url?: unknown } | null)?.checkout_url
  if (typeof url !== 'string' || !url.startsWith('https://')) throw new ApiError("We couldn't start the online payment.")
  return url
}
