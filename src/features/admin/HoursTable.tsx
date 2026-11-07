import { useState } from 'react'
import { DAY_NAMES, DISPLAY_DAY_ORDER, formatHour } from '../../lib/format'
import type { SchedulePeriod } from './api'
import {
  addBreak,
  closeHours,
  daySorted,
  hourLabel,
  hourOfMinute,
  maxEnd,
  overlapMessage,
  periodsOfDay,
  removeBreak,
  setDayOpen,
  withDay,
} from './weeklySchedule'

const OPEN_HOURS = Array.from({ length: 24 }, (_, i) => i)
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i)
const at = (day: number, start: number, end: number): SchedulePeriod => ({ day_of_week: day, start_minute: start * 60, end_minute: end * 60 })
const COPY_TARGETS: [string, number[]][] = [['Mon–Fri', [1, 2, 3, 4, 5]], ['Sat & Sun', [6, 0]], ['every day', [0, 1, 2, 3, 4, 5, 6]]]

/**
 * The opening hours table (T17.32): one row per day with an Open/Closed switch, the day's opening and closing, and its
 * breaks (the closed gaps between saved periods, as many as the day has). A day loads and saves whatever periods it holds.
 */
export function HoursTable({ periods, saved, onChange }: {
  periods: SchedulePeriod[]
  /** The loaded schedule, so switching a day back on restores its saved hours. */
  saved: SchedulePeriod[]
  onChange: (next: SchedulePeriod[]) => void
}) {
  const [copyFrom, setCopyFrom] = useState(1)

  function setOpens(day: number, hour: number) {
    const mine = daySorted(periods, day)
    const rest = mine.filter((p) => hourOfMinute(p.end_minute) > hour)
    if (rest.length === 0) return onChange(withDay(periods, day, [at(day, hour, hour + 1)]))
    // Keep what fits within a day's longest run from the new opening; the last range closes at the latest by then.
    const limit = maxEnd(hour)
    const fit = rest.filter((p, i) => i === 0 || hourOfMinute(p.start_minute) < limit)
    const next = fit.map((p, i) => {
      const start = i === 0 ? hour : hourOfMinute(p.start_minute)
      const end = i === fit.length - 1 ? Math.min(hourOfMinute(p.end_minute), Math.max(limit, start + 1)) : hourOfMinute(p.end_minute)
      return at(day, start, Math.max(end, start + 1))
    })
    onChange(withDay(periods, day, next))
  }
  function setCloses(day: number, hour: number) {
    const mine = daySorted(periods, day)
    onChange(withDay(periods, day, mine.map((p, i) => (i === mine.length - 1 ? { ...p, end_minute: hour * 60 } : p))))
  }
  /** Moves break `i` (between ranges i and i+1): `edge` is where it starts (the earlier range's end) or ends. */
  function setBreak(day: number, i: number, edge: 'starts' | 'ends', hour: number) {
    const mine = daySorted(periods, day)
    onChange(withDay(periods, day, mine.map((p, j) => {
      if (edge === 'starts' && j === i) return { ...p, end_minute: hour * 60 }
      if (edge === 'ends' && j === i + 1) return { ...p, start_minute: hour * 60 }
      return p
    })))
  }
  function copyTo(days: number[]) {
    const source = periodsOfDay(periods, copyFrom)
    onChange([
      ...periods.filter((p) => !days.includes(p.day_of_week)),
      ...days.flatMap((d) => source.map((p) => ({ day_of_week: d, start_minute: p.start_minute, end_minute: p.end_minute }))),
    ])
  }

  return (
    <div className="stack">
      <div className="hours-table">
        {DISPLAY_DAY_ORDER.map((day) => {
          const name = DAY_NAMES[day]
          const mine = daySorted(periods, day)
          const open = mine.length > 0
          const overlap = overlapMessage(periods, day)
          const first = mine[0]
          const last = mine.at(-1)
          const opens = first ? hourOfMinute(first.start_minute) : 0
          const closes = last ? hourOfMinute(last.end_minute) : 0
          // Closing: after the last range opens, up to 23 hours after the day opens (24 only 12 AM – Midnight); a saved
          // close outside that list stays offered so it loads unchanged.
          const closeList = last ? closeHours(opens).filter((h) => h > hourOfMinute(last.start_minute)) : []
          if (last && !closeList.includes(closes)) closeList.push(closes)
          closeList.sort((a, b) => a - b)
          return (
            <fieldset key={day} className="hours-day-row">
              <legend className="hours-day">{name}</legend>
              <div className="hours-day-body">
              <div className="hours-day-line">
                <button type="button" role="switch" aria-checked={open} aria-label={`${name} open`} className="switch"
                  onClick={() => onChange(setDayOpen(periods, day, !open, saved))}>
                  <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
                  <span className="switch-text">{open ? 'Open' : 'Closed'}</span>
                </button>
                {open && (
                  <span className="hours-range">
                    <select aria-label={`${name} opens`} value={opens} onChange={(e) => setOpens(day, Number(e.target.value))}>
                      {OPEN_HOURS.map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
                    </select>
                    <span className="muted">to</span>
                    <select aria-label={`${name} closes`} value={closes} onChange={(e) => setCloses(day, Number(e.target.value))}>
                      {closeList.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                    </select>
                  </span>
                )}
              </div>
              {mine.slice(1).map((after, i) => {
                const before = mine[i]
                const from = hourOfMinute(before.end_minute)
                const to = hourOfMinute(after.start_minute)
                const label = `${name} break ${i + 1}`
                return (
                  <div key={i} className="hours-break">
                    <span className="hours-break-text">{`Break ${hourLabel(from)} – ${hourLabel(to)}`}</span>
                    <span className="hours-range">
                      <select aria-label={`${label} starts`} value={from} onChange={(e) => setBreak(day, i, 'starts', Number(e.target.value))}>
                        {range(hourOfMinute(before.start_minute) + 1, to).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                      </select>
                      <span className="muted">to</span>
                      <select aria-label={`${label} ends`} value={to} onChange={(e) => setBreak(day, i, 'ends', Number(e.target.value))}>
                        {range(from, hourOfMinute(after.end_minute) - 1).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                      </select>
                    </span>
                    <button type="button" className="btn btn-small btn-ghost" aria-label={`Remove break ${i + 1} on ${name}`}
                      onClick={() => onChange(removeBreak(periods, day, i))}>
                      Remove break
                    </button>
                  </div>
                )
              })}
              {overlap && <p className="form-error" role="alert">{overlap}</p>}
              {open && (
                <button type="button" className="btn btn-small btn-ghost hours-add-break" aria-label={`Add a break to ${name}`}
                  onClick={() => onChange(addBreak(periods, day))}>
                  + Add a break
                </button>
              )}
              </div>
            </fieldset>
          )
        })}
      </div>
      <div className="hours-copy" role="group" aria-label="Copy hours">
        <label className="field">
          <span>Copy hours from</span>
          <select value={copyFrom} onChange={(e) => setCopyFrom(Number(e.target.value))}>
            {DISPLAY_DAY_ORDER.map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
          </select>
        </label>
        <div className="form-actions">
          {COPY_TARGETS.map(([label, days]) => (
            <button key={label} type="button" className="btn btn-small btn-outline" onClick={() => copyTo(days)}>{`Copy to ${label}`}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
