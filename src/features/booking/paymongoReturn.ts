// The round trip to PayMongo's hosted checkout (SPEC §4, RESEARCH M7). PayMongo sends the player back to
// /booking/:ref?paid=1 (success) or ?paid=0 (cancel). The guest token can't travel with them: it lives in the URL
// fragment and must never be sent to PayMongo, so it's kept in sessionStorage (same tab, same origin) meanwhile.
import type { BookingDetail } from './api'

export type PaidParam = 'success' | 'cancel' | null

export function readPaidParam(search: string): PaidParam {
  const paid = new URLSearchParams(search).get('paid')
  return paid === '1' ? 'success' : paid === '0' ? 'cancel' : null
}

const storageKey = (ref: string) => `paymongo-guest-token:${ref.toUpperCase()}`

/** Saved just before leaving for PayMongo. Storage can be unavailable (private mode); then the guest uses their link. */
export function rememberGuestToken(ref: string, token: string) {
  try {
    sessionStorage.setItem(storageKey(ref), token)
  } catch {
    // ignore: the saved private link still works
  }
}

export function recallGuestToken(ref: string): string | null {
  try {
    return sessionStorage.getItem(storageKey(ref))
  } catch {
    return null
  }
}

const startKey = (ref: string) => `paymongo-checkout-started:${ref.toUpperCase()}`

/** When this tab left for PayMongo, so an older not-accepted online payment isn't read as this one's outcome. */
export function rememberCheckoutStart(ref: string, at: number) {
  try {
    sessionStorage.setItem(startKey(ref), String(at))
  } catch {
    // ignore: without it, every online payment on the booking counts
  }
}

export function recallCheckoutStart(ref: string): number | null {
  try {
    const at = Number(sessionStorage.getItem(startKey(ref)))
    return Number.isFinite(at) && at > 0 ? at : null
  } catch {
    return null
  }
}

/** Server and browser clocks can differ; a payment this much older than the departure still counts. */
export const CLOCK_SKEW_MS = 2 * 60_000

/**
 * The token to put back in the fragment after a PayMongo return, or null when there's nothing to restore
 * (not a return, the URL already has a token, or this tab never saved one).
 */
export function tokenToRestore(ref: string, token: string | null, paid: PaidParam) {
  return token === null && paid !== null ? recallGuestToken(ref) : null
}

/** How long to wait for the webhook before saying so. */
export const CONFIRM_TIMEOUT_MS = 90_000

export type ReturnState = 'confirming' | 'confirmed' | 'not_accepted' | 'timeout' | 'cancelled' | null

/**
 * What to tell a player who just came back from PayMongo, given the booking as last fetched. `startedAt` is when this
 * tab left for the checkout (if known): a not-accepted online payment from before then belongs to an earlier attempt.
 */
export function paymongoReturnState(
  paid: PaidParam,
  booking: Pick<BookingDetail, 'status' | 'payments'>,
  elapsedMs: number,
  startedAt: number | null = null,
): ReturnState {
  if (paid === null) return null
  const online = booking.payments.filter((p) => p.method === 'paymongo')
  const thisAttempt = startedAt === null ? online : online.filter((p) => Date.parse(p.submitted_at) >= startedAt - CLOCK_SKEW_MS)
  if (paid === 'cancel') return booking.status === 'pending_payment' && thisAttempt.length === 0 ? 'cancelled' : null
  if (online.some((p) => p.review_status === 'approved')) return 'confirmed'
  if (thisAttempt.some((p) => p.review_status === 'rejected')) return 'not_accepted'
  return elapsedMs >= CONFIRM_TIMEOUT_MS ? 'timeout' : 'confirming'
}

/** Polling while we wait for the webhook: quick at first, then slower after the timeout message (never stops). */
export function returnPollMs(state: ReturnState): number | null {
  return state === 'confirming' ? 3_000 : state === 'timeout' ? 30_000 : null
}

/**
 * The return state lives in history state, not the URL: `?paid=` is dropped as soon as the player is back, so a
 * copied link or bookmark never re-enters the return flow.
 */
export function readReturnState(state: unknown): PaidParam {
  const paid = (state as { paymongoReturn?: unknown } | null)?.paymongoReturn
  return paid === 'success' || paid === 'cancel' ? paid : null
}

/** Leaves the app for PayMongo's hosted checkout (its own function so tests can replace it). */
export function goToCheckout(url: string) {
  window.location.assign(url)
}
