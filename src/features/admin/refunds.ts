// Refund records (T30.5, T30.6; SPEC §4): created as owed by the database, then closed by staff as refunded or not
// refunded. A record only: no money moves through the app. These checks mirror update_refund, which re-checks them.
import type { Enums } from '../../lib/database.types'
import { formatMoney } from '../../lib/format'
import type { AdminBooking, AdminRefund } from './api'

export type RefundStatus = Enums<'refund_status'>
export type PaymentMethod = Enums<'payment_method'>

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  owed: 'Refund owed',
  settled: 'Refunded',
  not_refunded: 'Not refunded',
}

/** How staff can say a refund was made: the manual methods and PayMongo's dashboard (never "account"). */
export const REFUND_METHODS = ['gcash', 'maya', 'bank_transfer', 'cash', 'paymongo'] as const satisfies readonly PaymentMethod[]

export const MAX_REASON = 500

export function owedRefunds(booking: Pick<AdminBooking, 'refunds'>): AdminRefund[] {
  return booking.refunds.filter((r) => r.status === 'owed')
}

export function hasOwedRefund(booking: Pick<AdminBooking, 'refunds'>) {
  return owedRefunds(booking).length > 0
}

export type SettleInput = { amount: string; method: string; settledOn: string }
export type SettleErrors = Partial<Record<keyof SettleInput, string>>
export type SettleResult =
  | { ok: true; value: { amount: number; method: PaymentMethod; settledOn: string } }
  | { ok: false; errors: SettleErrors }

const AMOUNT = /^\d+(\.\d{1,2})?$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

function isRealDate(text: string) {
  if (!DATE.test(text)) return false
  const d = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text
}

/** A settled refund needs an amount above 0 and at most what was paid, a method, and a venue date up to today. */
export function validateSettle(input: SettleInput, { paid, today, currency }: { paid: number; today: string; currency: string }): SettleResult {
  const errors: SettleErrors = {}
  const text = input.amount.trim()
  const amount = Number(text)
  if (!AMOUNT.test(text) || !(amount > 0) || amount > paid) errors.amount = `Enter an amount above 0, up to ${formatMoney(paid, currency)}.`
  if (!(REFUND_METHODS as readonly string[]).includes(input.method)) errors.method = 'Choose how the refund was made.'
  if (!isRealDate(input.settledOn) || input.settledOn > today) errors.settledOn = 'Choose the date the refund was made, today or earlier.'
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { amount, method: input.method as PaymentMethod, settledOn: input.settledOn } }
}

/** Not refunded needs a reason, which the player sees. */
export function validateNotRefunded(reason: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = reason.trim()
  if (!value) return { ok: false, error: 'Give a reason so the player knows why.' }
  if (value.length > MAX_REASON) return { ok: false, error: 'Keep the reason under 500 characters.' }
  return { ok: true, value }
}
