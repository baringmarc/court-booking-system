// What a player sees about a refund (T30.5, T30.6; SPEC §4): get_guest_booking's `refund` column or
// get_own_booking_refund, the booking's latest refund. Only these five fields: never the staff note or who recorded it.
import { Constants, type Enums, type Json } from '../../lib/database.types'
import { formatMoney } from '../../lib/format'
import { formatDateLabel } from '../../lib/time'
import { METHOD_LABELS } from './proofInput'

export type PlayerRefund = {
  status: Enums<'refund_status'>
  amount: number
  method: Enums<'payment_method'> | null
  /** The venue calendar date it was refunded. */
  settled_on: string | null
  /** Why there was no refund. */
  reason: string | null
}

const STATUSES: readonly string[] = Constants.public.Enums.refund_status
const METHODS: readonly string[] = Constants.public.Enums.payment_method

/** The refund JSON → the player fields, dropping anything else; null when there is none or it can't be read. */
export function parsePlayerRefund(json: Json | null | undefined): PlayerRefund | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  const { status, amount, method, settled_on, reason } = json
  if (typeof status !== 'string' || !STATUSES.includes(status)) return null
  return {
    status: status as Enums<'refund_status'>,
    amount: Number(amount ?? 0) || 0,
    method: typeof method === 'string' && METHODS.includes(method) ? (method as Enums<'payment_method'>) : null,
    settled_on: typeof settled_on === 'string' ? settled_on : null,
    reason: typeof reason === 'string' ? reason : null,
  }
}

/** "The venue owes you a refund of ₱350", "Refunded ₱350 by GCash on Mon, Jan 7" or "No refund: <reason>". */
export function refundMessage(refund: PlayerRefund, { currency, timeZone }: { currency: string; timeZone: string }) {
  const money = formatMoney(refund.amount, currency)
  if (refund.status === 'owed') return `The venue owes you a refund of ${money}`
  if (refund.status === 'not_refunded') return `No refund: ${refund.reason ?? ''}`.trimEnd()
  const by = refund.method ? ` by ${METHOD_LABELS[refund.method]}` : ''
  const on = refund.settled_on ? ` on ${formatDateLabel(refund.settled_on, timeZone)}` : ''
  return `Refunded ${money}${by}${on}`
}
