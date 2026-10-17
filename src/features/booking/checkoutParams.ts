// The /book → /book/checkout hand-off lives in the URL, so checkout survives a refresh
// and "back to the grid" returns to the same date and sport.

export type CheckoutParams = { courtId: string; start: string; slots: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function toCheckoutSearch({ courtId, start, slots }: CheckoutParams) {
  return new URLSearchParams({ court: courtId, start, slots: String(slots) }).toString()
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
