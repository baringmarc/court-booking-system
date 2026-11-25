// Booking groups on /admin/bookings (M33, T33.4 and T33.6; SPEC §7): one review-queue row per checkout, titled with its
// lead, and the payments that pay the whole group once (one payment row per court, a proof's file on one of them).
import type { AdminBooking, AdminPayment } from './api'

export type QueueEntry = { booking: AdminBooking; courts: AdminBooking[] }

const byStart = (a: AdminBooking, b: AdminBooking) =>
  Date.parse(a.slot_start) - Date.parse(b.slot_start) || a.court_id.localeCompare(b.court_id)

/**
 * The review queue (T33.6): one entry per checkout, where its first listed booking was, standing for the group's lead
 * (the payment note the player was given): the listed court that is `group_lead_id`, else the earliest listed one.
 */
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
  for (const entry of byGroup.values()) {
    entry.courts.sort(byStart)
    entry.booking = entry.courts.find((c) => c.id === entry.booking.group_lead_id) ?? entry.courts[0]
  }
  return entries
}

/** A checkout's PayMongo payments once each (T33.6): one row per court shares the PayMongo id; their amounts summed. */
export function checkoutOnlinePayments(courts: AdminBooking[]): AdminPayment[] {
  const byId = new Map<string, { payment: AdminPayment; centavos: number }>()
  const order: string[] = []
  for (const p of courts.flatMap((c) => c.payments).filter((p) => p.method === 'paymongo')) {
    const key = p.provider_payment_id ?? p.id
    const seen = byId.get(key)
    if (seen) { seen.centavos += Math.round(p.amount * 100); continue }
    byId.set(key, { payment: p, centavos: Math.round(p.amount * 100) })
    order.push(key)
  }
  return order
    .map((key) => { const { payment, centavos } = byId.get(key)!; return { ...payment, amount: centavos / 100 } })
    .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))
}

/** The group's pending proof: the payment with the file (else the first pending one) and the pending amounts summed. */
export function groupPayment(courts: AdminBooking[]): { payment: AdminPayment | null; amount: number } {
  const pending = courts.flatMap((c) => c.payments.filter((p) => p.review_status === 'pending'))
  const payment = pending.find((p) => p.storage_path) ?? pending[0] ?? null
  // In centavos, so ₱0.10 + ₱0.20 is ₱0.30.
  const centavos = pending.reduce((total, p) => total + Math.round(p.amount * 100), 0)
  return { payment, amount: centavos / 100 }
}
