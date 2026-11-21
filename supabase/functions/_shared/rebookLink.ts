// The "Same time next week" link in the confirmation and reminder emails (T30.3, SPEC §8). Plain TypeScript with no
// Deno APIs, so Vitest and tsc check it with the app. The query is the one src/features/booking/checkoutParams.ts
// (`toCheckoutSearch`) builds, plus `rebook`, the reference code of the booking being repeated (create_booking's
// p_rebook_of_reference; the link carries no ids of the booking or tokens). T30.4 builds the same link on the booking page.
import type { EmailData } from './emailTemplates.ts'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

type RebookData = Pick<EmailData, 'court_id' | 'slots' | 'starts_at' | 'reference_code'>

/** `<site>/book/checkout?court=…&start=<start + 7 days, UTC>&slots=…&rebook=<reference>`, or null for an old snapshot. */
export function rebookLink({ site, data }: { site: string; data: RebookData }): string | null {
  const slots = data.slots
  if (!data.court_id || typeof slots !== 'number' || !Number.isInteger(slots) || slots < 1) return null
  const start = Date.parse(data.starts_at)
  if (Number.isNaN(start)) return null
  // A week of real time: right for venues without daylight saving (every venue today is in Asia/Manila).
  const search = new URLSearchParams({ court: data.court_id, start: new Date(start + WEEK_MS).toISOString(), slots: String(slots) })
  search.set('rebook', data.reference_code)
  return `${site.replace(/\/+$/, '')}/book/checkout?${search.toString()}`
}
