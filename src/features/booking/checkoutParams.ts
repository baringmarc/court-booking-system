import type { Slot } from './selection'

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

/** One booking of a checkout (T33.3): a court and a run of `slots` hours from `start`. */
export type CheckoutRun = CheckoutParams

const MAX_RUNS = 6

/** One run keeps the old `court`/`start`/`slots` form; two or more are repeated `run=<court>,<start>,<slots>` params. */
export function toRunsSearch(runs: CheckoutRun[]) {
  if (runs.length === 1) return toCheckoutSearch(runs[0])
  const search = new URLSearchParams()
  for (const { courtId, start, slots } of runs) search.append('run', `${courtId},${start},${slots}`)
  return search.toString()
}

function parseRun(value: string): CheckoutRun | null {
  const parts = value.split(',')
  if (parts.length !== 3) return null
  const [court, start, slots] = parts
  return parseCheckoutSearch(new URLSearchParams({ court, start, slots }))
}

/**
 * The runs on a checkout URL: the old single-court form as one run, or 2-6 `run` params, none overlapping another on
 * its court. Null when the URL doesn't describe a usable selection.
 */
export function parseCheckoutRuns(params: URLSearchParams): CheckoutRun[] | null {
  const values = params.getAll('run')
  if (values.length === 0) {
    const one = parseCheckoutSearch(params)
    return one ? [one] : null
  }
  if (values.length < 2 || values.length > MAX_RUNS) return null
  const runs = values.map(parseRun)
  if (runs.some((r) => r === null)) return null
  const valid = runs as CheckoutRun[]
  const span = (r: CheckoutRun) => [Date.parse(r.start), Date.parse(r.start) + r.slots * 3_600_000] as const
  for (let i = 0; i < valid.length; i++) {
    for (let k = i + 1; k < valid.length; k++) {
      if (valid[i].courtId !== valid[k].courtId) continue
      const [a0, a1] = span(valid[i])
      const [b0, b1] = span(valid[k])
      if (a0 < b1 && b0 < a1) return null
    }
  }
  return valid
}

/**
 * The slots of `run` from fresh availability, or null unless every hour is free, consecutive and inside `period` (the
 * opening period the run starts in). Checkout re-checks the chosen runs with it and takes the prices from the server.
 */
export function freeRunSlots(run: CheckoutRun, slots: Slot[], period: { period_end: string } | undefined): Slot[] | null {
  if (!period) return null
  const courtSlots = slots.filter((s) => s.court_id === run.courtId)
  const first = courtSlots.findIndex((s) => Date.parse(s.slot_start) === Date.parse(run.start))
  if (first < 0) return null
  const picked = courtSlots.slice(first, first + run.slots)
  const ok = picked.length === run.slots && picked.every((s, i) =>
    s.status === 'free' && Date.parse(s.slot_end) <= Date.parse(period.period_end) && (i === 0 || picked[i - 1].slot_end === s.slot_start))
  return ok ? picked : null
}
