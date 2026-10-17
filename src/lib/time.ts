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
