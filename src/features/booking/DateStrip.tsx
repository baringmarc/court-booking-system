import { CalendarDays } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { CalendarDialog } from '../../components/DatePicker'
import { addDays } from '../../lib/time'
import { dayWord, fullDate, monthLabel, stripDays, stripStart, tileParts, weekdayOf } from './stripWindow'

type Props = {
  /** The chosen day, "YYYY-MM-DD" in the venue's calendar. */
  value: string
  onChange: (date: string) => void
  /** The venue's operating today; the first bookable day. */
  today: string
  /** The last bookable day (the booking window). */
  lastDay: string
  /** Days of the week (0 = Sunday) the venue is closed. */
  closedDays: number[]
}

/**
 * The /book day picker (T11.4a): a heading with the day, ‹ › one day at a time, "Jump to date" (the calendar), and a
 * strip of up to 10 days that slides to keep the chosen day in view.
 */
export function DateStrip({ value, onChange, today, lastDay, closedDays }: Props) {
  const [jumping, setJumping] = useState(false)
  // Where the strip started last time, so it moves only as far as it must (stored information from a previous render).
  const [start, setStart] = useState(() => stripStart(today, value, today, lastDay))
  const shownStart = stripStart(start, value, today, lastDay)
  if (shownStart !== start) setStart(shownStart)
  const days = stripDays(shownStart, today, lastDay)
  const stripRef = useRef<HTMLDivElement>(null)
  const labelId = useId()

  // On a phone the strip scrolls sideways: keep the chosen tile in view (inside the strip only).
  useEffect(() => {
    const strip = stripRef.current
    const tile = strip?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!strip || !tile) return
    const left = tile.offsetLeft - strip.offsetLeft
    if (left < strip.scrollLeft || left + tile.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo?.({ left: left - (strip.clientWidth - tile.offsetWidth) / 2 })
    }
  }, [value, shownStart])

  return (
    <div className="date-strip card" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="sr-only">Date</span>
      <div className="date-strip-head">
        <button type="button" className="btn btn-outline icon-btn" aria-label="Previous day"
          disabled={value <= today} onClick={() => onChange(addDays(value, -1))}>‹</button>
        <h2 className="date-strip-day" aria-live="polite">
          <span className="date-strip-word">{dayWord(value, today)}</span>{' '}
          <span className="date-strip-full">{fullDate(value)}</span>
        </h2>
        <button type="button" className="btn btn-outline date-strip-jump" aria-haspopup="dialog" onClick={() => setJumping(true)}>
          <CalendarDays aria-hidden="true" className="social-icon" />Jump to date
        </button>
        <button type="button" className="btn btn-outline icon-btn" aria-label="Next day"
          disabled={value >= lastDay} onClick={() => onChange(addDays(value, 1))}>›</button>
      </div>
      <p className="date-strip-month">{monthLabel(days[0], days[days.length - 1])}</p>
      <div className="date-strip-days" ref={stripRef}>
        {days.map((d) => {
          const { weekday, day, name } = tileParts(d)
          const closed = closedDays.includes(weekdayOf(d))
          return (
            <button key={d} type="button" className={`date-tile${d === today ? ' is-today' : ''}`} aria-pressed={d === value}
              disabled={closed} onClick={() => onChange(d)}>
              <span className="date-tile-weekday" aria-hidden="true">{weekday}</span>
              <span className="date-tile-day" aria-hidden="true">{day}</span>
              <span className="sr-only">{name}{d === today ? ', today' : ''}{closed ? ', closed' : ''}</span>
            </button>
          )
        })}
      </div>
      {jumping && (
        <CalendarDialog title="Choose a date" selected={value} today={today} min={today} max={lastDay} closedDays={closedDays}
          onSelect={onChange} onClose={() => setJumping(false)} />
      )}
    </div>
  )
}
