// Booking groups on /admin/bookings (M33, T33.4; SPEC §7): one review-queue row per checkout, a court's place in its
// checkout, and the one proof that pays the whole group (one payment row per court, the file on one of them).
import type { AdminBooking, AdminGroup, AdminPayment } from './api'

export type QueueEntry = { booking: AdminBooking; courts: AdminBooking[] }

/** The review queue: a group's first booking in list order stands for it, with all its listed bookings as `courts`. */
export function reviewQueueEntries(bookings: AdminBooking[]): QueueEntry[] {
  const byGroup = new Map<string, QueueEntry>()
  const entries: QueueEntry[] = []
  for (const booking of bookings) {
    const id = booking.booking_group_id
    if (!id) { entries.push({ booking, courts: [booking] }); continue }
    const entry = byGroup.get(id)
    if (entry) { entry.courts.push(booking); continue }
    const created = { booking, courts: [booking] }
    byGroup.set(id, created)
    entries.push(created)
  }
  return entries
}

/** "Booking X of N": 1-based, in the group's order (start, then court id). */
export function groupPosition(group: AdminGroup, bookingId: string) {
  return { index: group.bookings.findIndex((b) => b.id === bookingId) + 1, count: group.bookings.length }
}

/** The group's pending proof: the payment with the file (else the first pending one) and the pending amounts summed. */
export function groupPayment(courts: AdminBooking[]): { payment: AdminPayment | null; amount: number } {
  const pending = courts.flatMap((c) => c.payments.filter((p) => p.review_status === 'pending'))
  const payment = pending.find((p) => p.storage_path) ?? pending[0] ?? null
  // In centavos, so ₱0.10 + ₱0.20 is ₱0.30.
  const centavos = pending.reduce((total, p) => total + Math.round(p.amount * 100), 0)
  return { payment, amount: centavos / 100 }
}
