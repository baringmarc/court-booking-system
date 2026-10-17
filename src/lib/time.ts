// Timezone helpers. All timestamps are stored in UTC; the venue timezone is only for input/display.

function tzOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - (date.getTime() - date.getMilliseconds())
}

/** Wall-clock "YYYY-MM-DDTHH:mm" (as from <input type="datetime-local">) in `timeZone` → UTC ISO string. */
export function zonedLocalToISO(local: string, timeZone: string) {
  const [datePart, timePart = '00:00'] = local.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, hh, mm)
  // Two passes handle DST transitions; Asia/Manila has none but stay correct anyway.
  let ts = wall - tzOffsetMs(new Date(wall), timeZone)
  ts = wall - tzOffsetMs(new Date(ts), timeZone)
  return new Date(ts).toISOString()
}

export function formatInZone(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-PH', { timeZone, ...options }).format(new Date(iso))
}

export function formatDateTimeInZone(iso: string, timeZone: string) {
  return formatInZone(iso, timeZone, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Today's date ("YYYY-MM-DD") in `timeZone`. */
export function todayInZone(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** "YYYY-MM-DD" + n calendar days (timezone-free date arithmetic). */
export function addDays(date: string, days: number) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Postgres timestamptz text ("2026-10-20 02:00:00+00") → ISO string. */
function pgTimestampToISO(value: string) {
  const iso = value.trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp: ${value}`)
  return date.toISOString()
}

/** A tstzrange as returned by PostgREST ('["2026-10-20 02:00:00+00","2026-10-20 04:00:00+00")') → ISO bounds. */
export function parseTstzRange(value: unknown): { start: string; end: string } {
  if (typeof value !== 'string') throw new Error('Expected a range string')
  const match = /^[[(]"?([^",]+)"?,"?([^",]+)"?[\])]$/.exec(value.trim())
  if (!match) throw new Error(`Invalid range: ${value}`)
  return { start: pgTimestampToISO(match[1]), end: pgTimestampToISO(match[2]) }
}

/** Hour of day (0–23) of an instant in `timeZone`. */
export function hourInZone(iso: string, timeZone: string) {
  return Number(formatInZone(iso, timeZone, { hour: '2-digit', hourCycle: 'h23' })) % 24
}

/** "2026-10-17" → "Sat, Oct 17" (the calendar date itself, labelled in `timeZone`). */
export function formatDateLabel(date: string, timeZone: string) {
  return formatInZone(zonedLocalToISO(`${date}T12:00`, timeZone), timeZone, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}
