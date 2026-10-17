// Pure logic for the admin dashboard and walk-in form.
import type { Enums } from '../../lib/database.types'
import type { Slot } from '../booking/selection'

/**
 * Walk-ins may start in the slot that is in progress (SPEC §5.8). Availability reports a started slot as `past`
 * only when it is free (booked/blackout win once a slot has started), so `past` + not ended = free right now.
 */
export function isWalkInStartable(slot: Slot, now: Date) {
  return slot.status === 'free' || (slot.status === 'past' && Date.parse(slot.slot_end) > now.getTime())
}

/** How many consecutive slots a walk-in starting at `startIndex` can take (all startable and back to back). */
export function maxWalkInSlots(courtSlots: Slot[], startIndex: number, now: Date) {
  let count = 0
  for (let i = startIndex; i < courtSlots.length; i++) {
    const slot = courtSlots[i]
    const contiguous = i === startIndex || courtSlots[i - 1].slot_end === slot.slot_start
    if (!contiguous || !isWalkInStartable(slot, now)) break
    count++
  }
  return count
}

export type TakingsRow = { method: Enums<'payment_method'>; amount: number }

/** Today's takings per method, in a fixed display order, skipping methods with nothing taken. */
export function takingsByMethod(payments: TakingsRow[]) {
  const order: Enums<'payment_method'>[] = ['cash', 'gcash', 'maya', 'bank_transfer']
  const totals = new Map<Enums<'payment_method'>, number>()
  for (const p of payments) totals.set(p.method, (totals.get(p.method) ?? 0) + p.amount)
  const rows = order.filter((m) => totals.has(m)).map((method) => ({ method, total: Math.round(totals.get(method)! * 100) / 100 }))
  return { rows, total: Math.round(rows.reduce((sum, r) => sum + r.total, 0) * 100) / 100 }
}
