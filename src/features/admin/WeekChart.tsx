import { DISPLAY_DAY_ORDER, DAY_NAMES } from '../../lib/format'
import type { SchedulePeriod } from './api'
import { chartAxis, chartDayText, daySorted, hourLabel, hourOfMinute } from './weeklySchedule'

/**
 * Week at a glance (T17.32): the week being edited, one bar per day over an axis fitted to its earliest opening and
 * latest closing. Closed time is striped, after-midnight hours run past the day's midnight line, and each day has a text
 * description for screen readers (the drawing itself is hidden from them).
 */
export function WeekChart({ periods }: { periods: SchedulePeriod[] }) {
  const { from, to } = chartAxis(periods)
  const span = to - from
  const pct = (hour: number) => `${((hour - from) / span) * 100}%`
  const ticks = tickHours(from, to)
  return (
    <section className="week-chart stack" aria-labelledby="week-chart-title">
      <h3 id="week-chart-title">Week at a glance</h3>
      <ul className="week-chart-days">
        {DISPLAY_DAY_ORDER.map((day) => (
          <li key={day} className="week-chart-day">
            <span className="sr-only">{chartDayText(periods, day)}</span>
            <span className="week-chart-name" aria-hidden="true">{DAY_NAMES[day].slice(0, 3)}</span>
            <span className="week-chart-track" aria-hidden="true">
              {from < 24 && to > 24 && <span className="week-chart-midnight" style={{ left: pct(24) }} />}
              {daySorted(periods, day).map((p) => (
                <span key={p.start_minute} className="week-chart-open"
                  style={{ left: pct(hourOfMinute(p.start_minute)), width: pct(from + hourOfMinute(p.end_minute) - hourOfMinute(p.start_minute)) }} />
              ))}
            </span>
          </li>
        ))}
      </ul>
      <div className="week-chart-axis" aria-hidden="true">
        {ticks.map((h) => <span key={h} style={{ left: pct(h) }}>{hourLabel(h).replace(' (next day)', '')}</span>)}
      </div>
    </section>
  )
}

/** About four labels across the axis, on whole hours, ends included. */
function tickHours(from: number, to: number) {
  const step = Math.max(1, Math.ceil((to - from) / 4))
  const out: number[] = []
  for (let h = from; h < to; h += step) out.push(h)
  if (to - (out.at(-1) ?? from) >= step / 2) out.push(to)
  return out
}
