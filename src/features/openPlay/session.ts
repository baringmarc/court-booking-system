// Pure helpers for open play sessions (T9.11d). The database checks every rule; these keep the UI honest.
import { formatHour } from '../../lib/format'
import { formatDateLabel, hourInZone, todayInZone } from '../../lib/time'

export type OpenPlayLink = { label: string; url: string }

export const MAX_LINKS = 3
export const TITLE_MAX = 80
export const DETAILS_MAX = 2000
export const LABEL_MAX = 40

/** An absolute https URL with a host. Anything else (http, javascript:, relative) is never rendered as a link. */
export function isHttpsUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname.includes('.')
  } catch {
    return false
  }
}

/** The stored links jsonb → labelled https links, dropping anything malformed. */
export function toLinks(value: unknown): OpenPlayLink[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((l): l is Record<string, unknown> => typeof l === 'object' && l !== null)
    .map((l) => ({ label: typeof l.label === 'string' ? l.label.trim() : '', url: typeof l.url === 'string' ? l.url : '' }))
    .filter((l) => l.label && isHttpsUrl(l.url))
    .slice(0, MAX_LINKS)
}

/**
 * The form's link rows → the links to save, or an error for the first bad row. Empty rows are skipped;
 * a row with only one half filled is an error.
 */
export function linksFromRows(rows: OpenPlayLink[]): { links: OpenPlayLink[]; error: string | null } {
  const links: OpenPlayLink[] = []
  for (const [i, row] of rows.entries()) {
    const label = row.label.trim()
    const url = row.url.trim()
    if (!label && !url) continue
    if (!label) return { links, error: `Link ${i + 1} needs a label.` }
    if (!isHttpsUrl(url)) return { links, error: `Link ${i + 1} needs an address starting with https://.` }
    links.push({ label, url })
  }
  return { links, error: null }
}

/** "Sat, Oct 25 · 1 PM – 3 PM", on the start's calendar date; an end past midnight says "(next day)" (as the grid). */
export function sessionTimeLabel(start: string, end: string, timeZone: string) {
  const startDate = todayInZone(timeZone, new Date(start))
  // Ending exactly at midnight is still the same day ("10 PM – 12 AM"), like the grid's last row.
  const nextDay = todayInZone(timeZone, new Date(Date.parse(end) - 1)) > startDate
  return `${formatDateLabel(startDate, timeZone)} · ${formatHour(hourInZone(start, timeZone))} – ${formatHour(hourInZone(end, timeZone))}${nextDay ? ' (next day)' : ''}`
}
