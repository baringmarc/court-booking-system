// "Same time next week" on the booking page (T30.4, SPEC §7): the same weekday and venue-local wall-clock time as the
// booking, in the first week that is still ahead. Whole local calendar weeks, so a venue with daylight saving keeps its
// hour (the email link in supabase/functions/_shared/rebookLink.ts adds 7 × 24 hours, the same for Asia/Manila).
import { addDays, isoToZonedLocal, zonedLocalToISO } from '../../lib/time'

const WEEK_MS = 7 * 24 * 3_600_000

/** The first start strictly after `now`: `slotStart` + 7 local days, + 14 if that has passed, and so on (UTC ISO). */
export function nextSameTimeStart(slotStart: string, timeZone: string, now: Date): string {
  const [date, time] = isoToZonedLocal(slotStart, timeZone).split('T')
  // Jump close to now first (a week ahead of the last whole week passed), then step: an hour of DST drift at most.
  let weeks = Math.max(1, Math.floor((now.getTime() - Date.parse(slotStart)) / WEEK_MS))
  for (;;) {
    const start = zonedLocalToISO(`${addDays(date, 7 * weeks)}T${time}`, timeZone)
    if (Date.parse(start) > now.getTime()) return start
    weeks += 1
  }
}
