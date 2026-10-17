import { DAY_SHORT, DISPLAY_DAY_ORDER, formatHour, hourOf } from '../../lib/format'
import type { OperatingHours } from './api'

/** "Open daily, 6 AM – 10 PM" or grouped lines like "Mon–Fri: 6 AM – 10 PM", "Sun: Closed". */
export function summarizeHours(hours: OperatingHours[]): string[] {
  const byDay = new Map(hours.map((h) => [h.day_of_week, h]))
  const label = (h: OperatingHours | undefined) =>
    !h || h.is_closed ? 'Closed' : `${formatHour(hourOf(h.open_time))} – ${formatHour(hourOf(h.close_time))}`

  const groups: { days: number[]; text: string }[] = []
  for (const day of DISPLAY_DAY_ORDER) {
    const text = label(byDay.get(day))
    const last = groups.at(-1)
    if (last && last.text === text) last.days.push(day)
    else groups.push({ days: [day], text })
  }

  if (groups.length === 1) {
    return [groups[0].text === 'Closed' ? 'Temporarily closed' : `Open daily, ${groups[0].text}`]
  }
  return groups.map(({ days, text }) => {
    const first = DAY_SHORT[days[0]]
    const span = days.length === 1 ? first : `${first}–${DAY_SHORT[days.at(-1)!]}`
    return `${span}: ${text}`
  })
}
