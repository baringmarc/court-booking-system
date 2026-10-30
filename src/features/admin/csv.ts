// CSV export (T10.8, RESEARCH M10 "CSV export"): RFC 4180 quoting, protection against spreadsheet formula injection,
// CRLF lines and a UTF-8 BOM so Excel reads ₱ and ñ. Times are venue-local; amounts are plain numbers.
import { isoToZonedLocal } from '../../lib/time'
import { paymentLabel } from '../booking/proofInput'
import { displayStatus, STATUS_LABELS } from '../booking/status'
import { SPORT_LABELS } from '../catalog/api'
import type { ExportBooking, ExportPayment } from './api'

export type Cell = string | number | null

// A cell starting with one of these can run as a formula (OWASP), full-width forms included.
const FORMULA_START = /^[=+\-@\t\r\n＝＋－＠]/

/** One quoted cell. Text that could start a formula gets a leading apostrophe; numbers are written as they are. */
export function csvCell(value: Cell) {
  if (value === null) return '""'
  let text = String(value)
  if (typeof value === 'string' && (FORMULA_START.test(text) || FORMULA_START.test(text.trimStart()))) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

/** A whole file: a BOM, the header row, then one CRLF-ended line per row. */
export function toCsv(headers: string[], rows: Cell[][]) {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

/** "2026-10-25 14:00" in the venue's zone. */
export function csvTime(iso: string | null, timeZone: string) {
  return iso ? isoToZonedLocal(iso, timeZone).replace('T', ' ') : null
}

type Options = { timeZone: string; currency: string; now?: Date }

/** Bookings by play date. Phone and email only with `includeContact` (off by default, Data Privacy Act). */
export function bookingsCsv(bookings: ExportBooking[], { timeZone, currency, now = new Date(), includeContact }: Options & { includeContact: boolean }) {
  const headers = [
    'reference', 'court', 'sport', `start (${timeZone})`, `end (${timeZone})`, 'status', 'source', 'name',
    ...(includeContact ? ['phone', 'email'] : []),
    `amount_${currency.toLowerCase()}`,
    `booking_fee_${currency.toLowerCase()}`,
  ]
  const rows = bookings.map((b): Cell[] => [
    b.reference_code, b.court_name, b.sport ? SPORT_LABELS[b.sport] ?? b.sport : null, csvTime(b.slot_start, timeZone), csvTime(b.slot_end, timeZone),
    STATUS_LABELS[displayStatus(b, now)], b.source === 'walk_in' ? 'Walk-in' : 'Online', b.guest_name,
    ...(includeContact ? [b.guest_phone, b.guest_email] : []),
    b.total_amount,
    b.booking_fee,
  ])
  return toCsv(headers, rows)
}

/** Payments by the date the money came in: accepted ones, and PayMongo payments to refund. */
export function paymentsCsv(payments: ExportPayment[], { timeZone, currency }: Options) {
  const headers = ['booking reference', 'method', `amount_${currency.toLowerCase()}`, 'reference number', `received (${timeZone})`, 'status']
  const rows = payments.map((p): Cell[] => [
    p.booking_reference, paymentLabel(p), p.amount, p.reference_number, csvTime(p.received_at, timeZone),
    p.review_status === 'approved' ? 'Accepted' : 'Refund due',
  ])
  return toCsv(headers, rows)
}

/** Saves `text` as a file through a temporary link. */
export function downloadCsv(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // Later, not at once: some browsers cancel a download whose URL is revoked straight after the click.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
