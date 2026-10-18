// What staff need to follow up on after PayMongo (SPEC §4): payments the webhook couldn't accept (refund outside
// the app), and proofs it closed because the customer also paid online (check for a duplicate payment).
import type { AdminBooking, AdminPayment } from './api'

const SOURCE_LABELS: Record<string, string> = { gcash: 'GCash', paymaya: 'Maya', card: 'Card', qrph: 'QR Ph', grab_pay: 'GrabPay' }

/** PayMongo's source.type as shown to staff. */
export function sourceLabel(source: string | null) {
  if (!source) return null
  return SOURCE_LABELS[source] ?? source
}

export function onlinePayments(booking: Pick<AdminBooking, 'payments'>) {
  return booking.payments.filter((p) => p.method === 'paymongo')
}

/** Received online but not accepted for this booking (late, or the wrong amount): staff refund it outside the app. */
export function isRefundDue(p: AdminPayment) {
  return p.method === 'paymongo' && p.review_status === 'rejected'
}

/** The note record_paymongo_payment writes when it closes a pending proof (SPEC §4 case 3). */
export const SUPERSEDED_PROOF_NOTE = 'Paid online with PayMongo instead.'

/**
 * A proof closed automatically because the customer paid online. Only the webhook RPC rejects without a reviewer, and
 * it always writes the same note; both are required, since deleting an admin's profile also nulls `reviewed_by`.
 */
export function isSupersededProof(p: AdminPayment) {
  return p.method !== 'paymongo' && p.review_status === 'rejected' && p.reviewed_by === null && p.review_note === SUPERSEDED_PROOF_NOTE
}

export type PaymentFlags = { refundDue: AdminPayment[]; supersededProofs: AdminPayment[] }

export function paymentFlags(booking: Pick<AdminBooking, 'payments'>): PaymentFlags {
  return {
    refundDue: booking.payments.filter(isRefundDue),
    supersededProofs: booking.payments.filter(isSupersededProof),
  }
}

export function hasPaidOnline(booking: Pick<AdminBooking, 'payments'>) {
  return booking.payments.some((p) => p.method === 'paymongo' && p.review_status === 'approved')
}
