// Pure helpers for the nightly production backup (T16.2). Used by scripts/backup-production.mjs and
// scripts/restore-check.mjs, which Node runs directly (it strips the types), so keep the syntax erasable.

const KEY_PATTERN = /^backups\/plotline-(\d{4})-(\d{2})-(\d{2})\.tar\.age$/
const DAY_MS = 24 * 60 * 60 * 1000

export const PRODUCTION_REF = 'sfssolhsthteonzgzfos'

/** Object key for the backup taken on the UTC date of `date`. */
export function backupKey(date: Date): string {
  return `backups/plotline-${date.toISOString().slice(0, 10)}.tar.age`
}

/** Keys to delete: backups more than `keepDays` UTC days older than `now`. Other keys are never returned. */
export function expiredKeys(keys: string[], now: Date, keepDays = 14): string[] {
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)
  return keys.filter((key) => {
    const m = KEY_PATTERN.exec(key)
    if (!m) return false
    const day = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)
    return !Number.isNaN(day) && (today - day) / DAY_MS > keepDays
  })
}

export type RowCountDiff = { table: string; source: number | null; target: number | null }

/** Tables whose row counts differ between two databases, or exist on one side only. */
export function diffRowCounts(source: Record<string, number>, target: Record<string, number>): RowCountDiff[] {
  const tables = [...new Set([...Object.keys(source), ...Object.keys(target)])].sort()
  const diffs: RowCountDiff[] = []
  for (const table of tables) {
    const s = table in source ? source[table] : null
    const t = table in target ? target[table] : null
    if (s !== t) diffs.push({ table, source: s, target: t })
  }
  return diffs
}

/** A restore wipes its target, so refuse the production project (and an empty URL). */
export function assertRestoreTarget(dbUrl: string, productionRef = PRODUCTION_REF): void {
  if (!dbUrl) throw new Error('Restore target is empty')
  if (dbUrl.includes(productionRef)) throw new Error('Refusing to restore into the production project')
}
