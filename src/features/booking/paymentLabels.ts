import type { PaymentAttempt } from './api'

/** The note record_paymongo_payment writes when it closes a pending proof (SPEC §4 case 3). */
export const SUPERSEDED_PROOF_NOTE = 'Paid online with PayMongo instead.'

/**
 * A proof that was closed because the customer paid online instead (not an admin rejection). Players don't see
 * `reviewed_by`, so this also requires the accepted online payment that replaced it.
 */
export function isReplacedByOnlinePayment(p: Pick<PaymentAttempt, 'method' | 'review_status' | 'review_note'>, all: Pick<PaymentAttempt, 'method' | 'review_status'>[]) {
  return (
    p.method !== 'paymongo' &&
    p.review_status === 'rejected' &&
    p.review_note === SUPERSEDED_PROOF_NOTE &&
    all.some((o) => o.method === 'paymongo' && o.review_status === 'approved')
  )
}
