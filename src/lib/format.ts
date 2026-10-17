export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** day_of_week values (0 = Sunday) in the order we display them: Monday first. */
export const DISPLAY_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

export function formatMoney(amount: number, currency = 'PHP') {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount)
}

/** 6 → "6 AM", 13 → "1 PM", 24 → "12 AM" (midnight close). */
export function formatHour(hour: number) {
  const h = hour % 24
  const suffix = h < 12 ? 'AM' : 'PM'
  return `${h % 12 === 0 ? 12 : h % 12} ${suffix}`
}

/** Postgres time "06:00:00" (or "24:00:00") → 6 */
export function hourOf(time: string) {
  return Number(time.slice(0, 2))
}

/** 6 → "06:00", for writing Postgres time values. */
export function hourToTime(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`
}
