// Request parsing and the authorization/status rules of the invoice-pdf Edge Function (T26.4). Plain TypeScript with
// no Deno APIs, so Vitest and tsc check it with the app.

export type InvoiceAction = 'pdf' | 'send'
export type InvoiceStatus = 'draft' | 'sent' | 'paid'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseInvoiceBody(raw: unknown): { ok: true; invoiceId: string; action: InvoiceAction } | { ok: false } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false }
  const { invoice_id, action } = raw as Record<string, unknown>
  if (typeof invoice_id !== 'string' || !UUID.test(invoice_id)) return { ok: false }
  if (action !== 'pdf' && action !== 'send') return { ok: false }
  return { ok: true, invoiceId: invoice_id, action }
}

/** `<SLUG>-<YYYYMM>`, the same derived number as the console (`src/features/console/invoiceNumber.ts`). */
export function invoiceNumber(slug: string, billingMonth: string): string {
  return `${slug.toUpperCase()}-${billingMonth.slice(0, 7).replace('-', '')}`
}

export type InvoiceAccessInput = {
  action: InvoiceAction
  isPlatformAdmin: boolean
  /** The caller is an admin of the invoice's own venue. */
  isVenueAdmin: boolean
  status: InvoiceStatus
  accountCount: number
  ownerCount: number
}
export type InvoiceRefusal = {
  ok: false
  status: number
  code: 'forbidden' | 'invalid_status' | 'billing_details_missing' | 'no_recipients'
  message: string
}

const refuse = (status: number, code: InvoiceRefusal['code'], message: string): InvoiceRefusal => ({ ok: false, status, code, message })

/**
 * pdf: platform admins get any invoice; a venue admin only a sent or paid invoice of their own venue (drafts are not
 * issued). send: platform admins only, then a paid invoice, missing Plotline payment details and a venue without
 * owners are refused, in that order. A sent invoice is a resend.
 */
export function invoiceAccess(input: InvoiceAccessInput): { ok: true } | InvoiceRefusal {
  if (input.action === 'pdf') {
    if (input.isPlatformAdmin) return { ok: true }
    if (input.isVenueAdmin && (input.status === 'sent' || input.status === 'paid')) return { ok: true }
    return refuse(403, 'forbidden', "You can't open this invoice.")
  }
  if (!input.isPlatformAdmin) return refuse(403, 'forbidden', 'Platform admins only.')
  if (input.status === 'paid') return refuse(409, 'invalid_status', 'This invoice is already paid.')
  if (input.accountCount < 1) {
    return refuse(409, 'billing_details_missing', 'Add Plotline payment details on the Billing page before sending.')
  }
  if (input.ownerCount < 1) return refuse(409, 'no_recipients', 'This venue has no owner to send the invoice to.')
  return { ok: true }
}
