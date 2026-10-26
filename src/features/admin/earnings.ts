// Pure logic for the dashboard's earnings section (T10.7): periods, the get_earnings result, and its figures.
import type { Enums, Json } from '../../lib/database.types'
import { addDays } from '../../lib/time'
import { dowOf } from '../catalog/hours'

export type Period = 'today' | 'week' | 'month' | 'custom'
export type DateRange = { from: string; to: string }

/** get_earnings accepts up to 366 days (T10.6). */
export const MAX_RANGE_DAYS = 366

/** Days in an inclusive range of "YYYY-MM-DD" dates. */
export function rangeDays({ from, to }: DateRange) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}

/** The Monday on or before `date` (weeks start on Monday, SPEC §10). */
export function weekStart(date: string) {
  return addDays(date, -((dowOf(date) + 6) % 7))
}

/**
 * The dates a period covers, whole periods so they compare cleanly with the one before: today; this week, Monday to
 * Sunday; this month, the 1st to its last day. Custom is the admin's own range.
 */
export function periodRange(period: Period, today: string, custom?: DateRange): DateRange {
  if (period === 'today') return { from: today, to: today }
  if (period === 'week') {
    const from = weekStart(today)
    return { from, to: addDays(from, 6) }
  }
  if (period === 'month') {
    const from = `${today.slice(0, 7)}-01`
    const [y, m] = today.split('-').map(Number)
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return { from, to: `${today.slice(0, 7)}-${String(last).padStart(2, '0')}` }
  }
  return custom ?? { from: today, to: today }
}

/** Why a custom range can't be used, or null. */
export function rangeProblem(range: DateRange) {
  if (range.to < range.from) return 'The end date is before the start date.'
  if (rangeDays(range) > MAX_RANGE_DAYS) return `Choose a range of up to ${MAX_RANGE_DAYS} days.`
  return null
}

/** How the previous period is named next to the change. */
export function previousLabel(period: Period, days: number) {
  if (period === 'today') return 'yesterday'
  if (period === 'week') return 'last week'
  return `the previous ${days} days`
}

type MethodTotal = { method: Enums<'payment_method'>; amount: number; count: number }
type Money = { total: number; count: number; byMethod: MethodTotal[] }
export type HourTotals = { openHours: number; blackoutHours: number; soldHours: number; openPlayHours: number }
export type Earnings = {
  from: string
  to: string
  collected: Money
  previous: Money & DateRange
  refundsDue: { count: number; total: number }
  daily: { date: string; collected: number; soldHours: number }[]
  courts: ({ courtId: string; name: string; sport: Enums<'sport'> } & HourTotals)[]
  sports: ({ sport: Enums<'sport'> } & HourTotals)[]
  comingUp: { count: number; value: number }
}

type Obj = { [key: string]: Json | undefined }
const obj = (v: Json | undefined): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const arr = (v: Json | undefined): Json[] => (Array.isArray(v) ? v : [])
const num = (v: Json | undefined) => (typeof v === 'number' ? v : Number(v ?? 0) || 0)
const str = (v: Json | undefined) => (typeof v === 'string' ? v : '')

function money(v: Json | undefined): Money {
  const o = obj(v)
  return {
    total: num(o.total),
    count: num(o.count),
    byMethod: arr(o.by_method).map((m) => ({
      method: str(obj(m).method) as Enums<'payment_method'>, amount: num(obj(m).amount), count: num(obj(m).count),
    })),
  }
}

function hours(o: Obj): HourTotals {
  return {
    openHours: num(o.open_hours), blackoutHours: num(o.blackout_hours),
    soldHours: num(o.sold_hours), openPlayHours: num(o.open_play_hours),
  }
}

/** get_earnings' JSON → typed figures (numbers, camelCase). Missing parts read as zero or empty. */
export function parseEarnings(json: Json): Earnings {
  const o = obj(json)
  const previous = obj(o.previous)
  return {
    from: str(o.from),
    to: str(o.to),
    collected: money(o.collected),
    previous: { ...money(previous), from: str(previous.from), to: str(previous.to) },
    refundsDue: { count: num(obj(o.refunds_due).count), total: num(obj(o.refunds_due).total) },
    daily: arr(o.daily).map((d) => ({ date: str(obj(d).date), collected: num(obj(d).collected), soldHours: num(obj(d).sold_hours) })),
    courts: arr(o.courts).map((c) => ({
      courtId: str(obj(c).court_id), name: str(obj(c).name), sport: str(obj(c).sport) as Enums<'sport'>, ...hours(obj(c)),
    })),
    sports: arr(o.sports).map((s) => ({ sport: str(obj(s).sport) as Enums<'sport'>, ...hours(obj(s)) })),
    comingUp: { count: num(obj(o.coming_up).count), value: num(obj(o.coming_up).value) },
  }
}

/**
 * Booked share of the bookable hours: sold ÷ (open − blackout), from 0 to 1. Null when nothing was bookable. Capped
 * at 1, since blackouts aren't checked against bookings (a booking under one counts as both).
 */
export function occupancy({ openHours, blackoutHours, soldHours }: HourTotals) {
  const bookable = openHours - blackoutHours
  if (bookable <= 0) return null
  return Math.min(1, Math.max(0, soldHours / bookable))
}

/** "42%", or "—" when nothing was bookable. */
export function formatShare(share: number | null) {
  return share === null ? '—' : `${Math.round(share * 100)}%`
}

/** "12 h", "1.5 h". */
export function formatHours(hours: number) {
  return `${Number.isInteger(hours) ? hours : Math.round(hours * 10) / 10} h`
}

/** The change from the previous period: the difference, and the percentage when there was something before. */
export function change(current: number, previous: number) {
  const diff = Math.round((current - previous) * 100) / 100
  return { diff, percent: previous > 0 ? Math.round((diff / previous) * 100) : null }
}

/** Each day's bar as a share of the best day, 0 to 1 (all zero when nothing came in). */
export function barShares(values: number[]) {
  const max = Math.max(0, ...values)
  return values.map((v) => (max > 0 ? Math.max(0, v) / max : 0))
}
