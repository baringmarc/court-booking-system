// Money and date formats shared by the invoice PDF and email (T26.4). The PDF fonts' Latin subset has no peso sign,
// so amounts print as `PHP 1,234.00` (RESEARCH "Milestone 26").

const NUMBER = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export function formatPhp(amount: number): string {
  const n = Math.round(amount * 100) / 100
  return `${n < 0 ? '-' : ''}PHP ${NUMBER.format(Math.abs(n))}`
}

const utc = (isoDate: string) => new Date(`${isoDate.slice(0, 10)}T00:00:00Z`)

/** `2026-11-03` → `Nov 3, 2026`. */
export const formatInvoiceDate = (isoDate: string) => DATE.format(utc(isoDate))
/** `2026-10-01` → `October 2026`. */
export const formatBillingMonth = (isoDate: string) => MONTH.format(utc(isoDate))
