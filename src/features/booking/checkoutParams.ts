// The /book → /book/checkout hand-off lives in the URL, so checkout survives a refresh
// and "back to the grid" returns to the same date and sport.

export type CheckoutParams = { courtId: string; start: string; slots: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `rebook` (T30.4) is the reference code of the booking a "Same time next week" link repeats, for create_booking. */
export function toCheckoutSearch({ courtId, start, slots, rebook }: CheckoutParams & { rebook?: string }) {
  const search = new URLSearchParams({ court: courtId, start, slots: String(slots) })
  if (rebook) search.set('rebook', rebook)
  return search.toString()
}

/** The "Same time next week" reference on the checkout URL, trimmed; null when absent or blank. */
export function parseRebookReference(params: URLSearchParams): string | null {
  return params.get('rebook')?.trim() || null
}

/** Returns null when the URL doesn't describe a usable selection. */
export function parseCheckoutSearch(params: URLSearchParams): CheckoutParams | null {
  const courtId = params.get('court') ?? ''
  const start = params.get('start') ?? ''
  const slots = Number(params.get('slots'))
  if (!UUID.test(courtId)) return null
  if (Number.isNaN(Date.parse(start))) return null
  if (!Number.isInteger(slots) || slots < 1 || slots > 24) return null
  return { courtId, start: new Date(start).toISOString(), slots }
}
