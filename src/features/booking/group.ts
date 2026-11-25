// A booking group as one checkout (M33, T33.4; SPEC §7 `/booking/:ref`): its status and what the player's cancel
// covers, derived from its courts. The RPCs decide; this only chooses what to show.
import type { BookingDetail, BookingGroupCourt } from './api'
import { isActive } from './cancellation'
import { displayStatus, type BookingStatus, type DisplayStatus } from './status'

type GroupCourt = { status: BookingStatus; slot_end: string; expires_at?: string | null }

const ORDER: readonly DisplayStatus[] = ['pending_payment', 'payment_submitted', 'confirmed', 'completed', 'expired', 'rejected']

/**
 * The group's status: of the courts that aren't cancelled, the first displayed status in ORDER (so "Confirmed" while
 * any court is confirmed and not played); "Cancelled" only when every court is.
 */
export function groupDisplayStatus(courts: GroupCourt[], now: Date): DisplayStatus {
  const shown = courts
    .filter((c) => c.status !== 'cancelled')
    .map((c) => displayStatus({ status: c.status, slot_end: c.slot_end, expires_at: c.expires_at ?? null }, now))
  return ORDER.find((s) => shown.includes(s)) ?? 'cancelled'
}

/**
 * What a player's cancel covers (cancel_booking cancels every active court): the active courts' span, for
 * playerCancel's deadline at the earliest active start. With no active court, the first court's values and 0.
 */
export function groupCancelInput(own: Pick<BookingDetail, 'expires_at'>, courts: BookingGroupCourt[], now: Date) {
  const withHold = courts.map((c) => ({ ...c, expires_at: own.expires_at }))
  const active = withHold.filter((c) => isActive(c, now))
  const pool = active.length > 0 ? active : withHold.slice(0, 1)
  if (pool.length === 0) return { status: 'cancelled' as BookingStatus, expires_at: own.expires_at, slot_start: '', slot_end: '', courts: 0 }
  const byTime = (a: string, b: string) => Date.parse(a) - Date.parse(b)
  const starts = pool.map((c) => c.slot_start).sort(byTime)
  const ends = pool.map((c) => c.slot_end).sort(byTime)
  return {
    status: pool[0].status,
    expires_at: own.expires_at,
    slot_start: starts[0],
    slot_end: ends[ends.length - 1],
    courts: active.length,
  }
}
