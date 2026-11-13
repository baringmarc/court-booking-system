// Turns the invoice's database rows into the PDF's data (T26.4). Plain TypeScript, so Vitest checks the item rows,
// dates and balance without the Edge Function.
import type { InvoicePdfAccount, InvoicePdfData, InvoicePdfItem } from './invoicePdf.ts'
import { invoiceNumber, type InvoiceStatus } from './invoiceRequest.ts'

export type InvoiceRows = {
  invoice: { billing_month: string; status: InvoiceStatus; sent_at: string | null }
  slug: string
  venueName: string
  address: string
  /** The venue's IANA timezone, for the invoice and due dates. */
  timezone: string
  graceDays: number
  /** `billing_charges` of the invoice: kind `booking_fee` or `adjustment` (negative). */
  charges: { kind: string; amount: number | string }[]
  /** Full names of the venue's owners (null when unset). */
  ownerNames: (string | null)[]
  accounts: InvoicePdfAccount[]
  supportEmail: string
  now: Date
}

const cents = (n: number) => Math.round(n * 100) / 100

/** The calendar date of an instant in a timezone, as YYYY-MM-DD. */
export function localDate(instant: Date, timezone: string): string {
  let tz = timezone
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
  } catch {
    tz = 'Asia/Manila'
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** One row per distinct amount: booking fees as count × rate, then venue cancellations credited. */
export function invoiceItems(charges: InvoiceRows['charges']): InvoicePdfItem[] {
  const group = (kind: string) => {
    const byRate = new Map<number, number>()
    for (const c of charges) {
      if (c.kind !== kind) continue
      const rate = cents(Number(c.amount))
      byRate.set(rate, (byRate.get(rate) ?? 0) + 1)
    }
    return [...byRate].sort(([a], [b]) => a - b)
  }
  const items: InvoicePdfItem[] = []
  for (const [rate, quantity] of group('booking_fee')) items.push({ description: 'Booking fees', quantity, rate, amount: cents(rate * quantity) })
  for (const [rate, quantity] of group('adjustment')) {
    if (rate !== 0) items.push({ description: 'Venue cancellations credited', quantity, rate, amount: cents(rate * quantity) })
  }
  return items
}

const names = (ownerNames: (string | null)[]) =>
  [...new Set(ownerNames.map((n) => n?.trim() ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b))

/** "Dear …": the owner's name when the venue has exactly one owner with a name, else the venue name. */
export function recipientName(ownerNames: (string | null)[], venueName: string): string {
  const named = names(ownerNames)
  return ownerNames.length === 1 && named.length === 1 ? named[0] : venueName
}

export function invoicePdfData(rows: InvoiceRows): InvoicePdfData {
  const { invoice } = rows
  const items = invoiceItems(rows.charges)
  const total = cents(items.reduce((sum, i) => sum + i.amount, 0))
  const issued = invoice.status !== 'draft' && invoice.sent_at ? new Date(invoice.sent_at) : rows.now
  const invoiceDate = localDate(issued, rows.timezone)
  const owners = names(rows.ownerNames)
  return {
    number: invoiceNumber(rows.slug, invoice.billing_month),
    status: invoice.status,
    invoiceDate,
    termsDays: rows.graceDays,
    dueDate: addDays(invoiceDate, rows.graceDays),
    billingMonth: invoice.billing_month,
    venueName: rows.venueName,
    ownerName: owners.length ? owners.join(', ') : null,
    address: rows.address,
    items,
    subTotal: total,
    total,
    balanceDue: invoice.status === 'paid' ? 0 : total,
    accounts: rows.accounts,
    supportEmail: rows.supportEmail,
  }
}

/** The image type from its first bytes, or null when it is neither PNG nor JPEG (pdf-lib embeds only those). */
export function imageKind(bytes: Uint8Array): 'png' | 'jpg' | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  return null
}
