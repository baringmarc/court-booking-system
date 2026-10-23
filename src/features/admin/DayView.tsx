import { Link } from 'react-router-dom'
import { formatHour } from '../../lib/format'
import { hourInZone, todayInZone } from '../../lib/time'
import { isAfterMidnight } from '../catalog/hours'
import type { Slot } from '../booking/selection'
import type { Court } from '../catalog/api'
import type { AdminBooking } from './api'
import { filtersToParams } from './bookingFilters'

type Props = {
  date: string
  courts: Pick<Court, 'id' | 'name'>[]
  /** The day's slots from get_availability: they give the grid its hours and the closed and past cells. */
  slots: Slot[]
  /** The day's active bookings, with full names (admins only, through RLS). */
  bookings: Pick<AdminBooking, 'id' | 'reference_code' | 'court_name' | 'slot_start' | 'slot_end' | 'guest_name'>[]
  timeZone: string
  /** Open play session titles by id (T9.11d); a cell without one still says "Open play". */
  sessionTitle?: (id: string) => string | undefined
}

/** Courts × hours for one day with each booker's full name and reference (T9.8). Players only see first names. */
export function DayView({ date, courts, slots, bookings, timeZone, sessionTitle }: Props) {
  const times = [...new Set(slots.map((s) => s.slot_start))].sort()
  if (times.length === 0) return <p className="muted">The venue is closed on this day.</p>

  // Each reference opens that booking: its own calendar date's list (an after-midnight booking is on the next
  // date, which is how /admin/bookings filters), with the booking preselected.
  const linkTo = (id: string, start: string) => {
    const params = filtersToParams({ status: 'all', source: 'all', date: todayInZone(timeZone, new Date(start)) })
    params.set('booking', id)
    return `/admin/bookings?${params}`
  }
  // Compare instants, not strings: slots come from get_availability ("…T13:00:00+00:00") and bookings from a
  // parsed range ("…T13:00:00.000Z"), so the same moment is written differently.
  const bookingAt = (court: string, start: string) => {
    const t = Date.parse(start)
    return bookings.find((b) => b.court_name === court && Date.parse(b.slot_start) <= t && t < Date.parse(b.slot_end))
  }

  return (
    // Focusable: on a phone the grid scrolls sideways and may hold no links (axe scrollable-region-focusable).
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Courts by hour">
      <table className="slot-grid day-grid">
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Time</span></th>
            {courts.map((c) => <th key={c.id} scope="col">{c.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {times.map((time) => (
            <tr key={time}>
              <th scope="row">{formatHour(hourInZone(time, timeZone))}{isAfterMidnight(time, date, timeZone) ? ' (next day)' : ''}</th>
              {courts.map((court) => {
                const booking = bookingAt(court.name, time)
                const slot = slots.find((s) => s.court_id === court.id && s.slot_start === time)
                if (booking) {
                  return (
                    <td key={court.id} className="day-cell day-booked">
                      <span className="day-name">{booking.guest_name}</span>
                      <Link to={linkTo(booking.id, booking.slot_start)} className="small">{booking.reference_code}</Link>
                    </td>
                  )
                }
                if (slot?.status === 'open_play') {
                  const title = slot.open_play_session_id ? sessionTitle?.(slot.open_play_session_id) : undefined
                  return (
                    <td key={court.id} className="day-cell day-open_play">
                      <span className="day-name">Open play</span>
                      {title && <span className="small">{title}</span>}
                    </td>
                  )
                }
                const text = !slot ? '—' : slot.status === 'blackout' ? 'Closed' : slot.status === 'past' ? '—' : ''
                return <td key={court.id} className={`day-cell day-${slot?.status ?? 'none'}`}>{text}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
