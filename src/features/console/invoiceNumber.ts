import type { InvoiceOverview } from './api'

/** The invoice number is derived, so there is no sequence to keep: `<SLUG>-<YYYYMM>`. */
export function invoiceNumber(invoice: Pick<InvoiceOverview, 'slug' | 'billing_month'>): string {
  return `${invoice.slug.toUpperCase()}-${invoice.billing_month.slice(0, 7).replace('-', '')}`
}
