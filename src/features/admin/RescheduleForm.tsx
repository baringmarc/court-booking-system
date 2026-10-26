import { useMemo, useState, type FormEvent } from 'react'
import { ChoiceGroup } from '../../components/ChoiceGroup'
import { DatePicker } from '../../components/DatePicker'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { closedDaysOfWeek } from '../../components/pickerHours'
import { formatHour } from '../../lib/format'
import { addDays, hourInZone } from '../../lib/time'
import { bookingErrorMessage } from '../booking/errors'
import { useAvailability } from '../booking/hooks'
import { rangeLabel } from '../booking/moves'
import type { Slot } from '../booking/selection'
import type { Court, OperatingHours, VenueSettings } from '../catalog/api'
import { isAfterMidnight, operatingToday } from '../catalog/hours'
import type { AdminBooking, Reschedule } from './api'
import { endAfter, isSplit, moveFromOptions, movedHours, validStarts } from './reschedule'

type Props = {
  booking: AdminBooking
  /** Active courts of every sport: the form offers the booking's sport only. */
  courts: Court[]
  hours: OperatingHours[]
  settings: Pick<VenueSettings, 'timezone' | 'booking_window_days'>
  now: Date
  pending: boolean
  error: unknown
  onSubmit: (input: Omit<Reschedule, 'bookingId'>) => void
  onClose: () => void
}

const hoursText = (n: number) => `${n} ${n === 1 ? 'hour' : 'hours'}`

/**
 * Staff move a confirmed booking (T10.10): the whole booking before it starts, or from an hour on once it has begun
 * (the earlier hours stay; the rest becomes its own booking). Only same-sport courts, and only starts with the same
 * number of free hours. The server checks every rule again (reschedule_booking) and never changes the price.
 */
export function RescheduleForm({ booking, courts, hours, settings, now, pending, error, onSubmit, onClose }: Props) {
  const tz = settings.timezone
  const sameSport = useMemo(
    () => courts.filter((c) => c.sport === booking.sport && c.is_active),
    [courts, booking.sport],
  )
  const fromOptions = moveFromOptions(booking, now)
  const today = operatingToday(hours, tz, now)
  const lastDay = addDays(today, settings.booking_window_days)

  const [from, setFrom] = useState<string | null>(fromOptions[0] ?? null)
  const [date, setDate] = useState(today)
  const [courtId, setCourtId] = useState(sameSport.some((c) => c.id === booking.court_id) ? booking.court_id : sameSport[0]?.id ?? '')
  const [startChoice, setStartChoice] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const availability = useAvailability(date)

  // Derived: a chosen hour that has ended while the form was open (`now` ticks) falls back to the first one on offer.
  const fromStart = fromOptions.length > 0 ? (from && fromOptions.includes(from) ? from : fromOptions[0]) : booking.slot_start
  const moved = movedHours(booking, fromStart)
  const splitting = isSplit(booking, fromStart)
  const courtSlots = useMemo<Slot[]>(
    () => (availability.data ?? []).filter((s) => s.court_id === courtId).sort((a, b) => a.slot_start.localeCompare(b.slot_start)),
    [availability.data, courtId],
  )
  const starts = validStarts(courtSlots, moved, now)
  // Derived, not synced: a start that stops fitting (another date, court or length) is simply not chosen.
  const start = starts.some((s) => s.slot_start === startChoice) ? startChoice : null
  const newCourt = sameSport.find((c) => c.id === courtId)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!courtId || !start) return setFormError('Choose a new court and start time.')
    if (!reason.trim()) return setFormError('Give a reason so the player knows why.')
    setFormError(null)
    onSubmit({ fromStart, courtId, start, reason: reason.trim() })
  }

  return (
    <form className="card stack" onSubmit={handleSubmit} noValidate aria-label="Reschedule booking">
      <h3>Reschedule booking</h3>
      <p className="small muted">
        Move it to another court of the same sport or another time. The price and payment don't change, and the player
        sees your reason.
      </p>

      {fromOptions.length > 0 && (
        <ChoiceGroup label="Move from" value={fromStart} onChange={setFrom}
          choices={fromOptions.map((iso) => ({ value: iso, label: formatHour(hourInZone(iso, tz)) }))} />
      )}
      <p className="small">
        Moving {hoursText(moved)}: {rangeLabel(fromStart, booking.slot_end, tz)}.
        {splitting && ' The earlier hours stay where they are, and the moved hours become a booking of their own.'}
      </p>

      <DatePicker label="New date" value={date} today={today} min={today} max={lastDay}
        closedDays={closedDaysOfWeek(hours)} timeZone={tz} onChange={setDate} />
      <div className="field">
        <label htmlFor="move-court">New court</label>
        <select id="move-court" value={courtId} onChange={(e) => setCourtId(e.target.value)}>
          {sameSport.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {availability.isPending ? (
        <PageLoader />
      ) : availability.isError ? (
        <ErrorMessage error={availability.error} onRetry={() => availability.refetch()} />
      ) : availability.data.length === 0 ? (
        <p className="muted small">The venue is closed on this day, or it's past the booking window.</p>
      ) : (
        <ChoiceGroup label="New start" value={start} onChange={setStartChoice}
          empty={`No ${hoursText(moved)} in a row are free on ${newCourt?.name ?? 'this court'} that day. Try another court or date.`}
          choices={starts.map((s) => ({
            value: s.slot_start,
            label: `${formatHour(hourInZone(s.slot_start, tz))}${isAfterMidnight(s.slot_start, date, tz) ? ' (next day)' : ''}${s.status === 'past' ? ' (now)' : ''}`,
          }))} />
      )}

      <div className="field">
        <label htmlFor="move-reason">Reason for moving</label>
        <textarea id="move-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>

      {start && newCourt && (
        <dl className="facts" aria-label="Summary">
          <div><dt>Moving</dt><dd>{booking.court_name}, {rangeLabel(fromStart, booking.slot_end, tz)}</dd></div>
          <div><dt>To</dt><dd>{newCourt.name}, {rangeLabel(start, endAfter(start, moved), tz)}</dd></div>
        </dl>
      )}
      {start && (
        <p className="small muted">If they booked online with an email, they get the new time and your reason by email.</p>
      )}

      {formError && <p className="form-error" role="alert">{formError}</p>}
      {error != null && <div className="alert alert-error" role="alert"><p>{bookingErrorMessage(error)}</p></div>}
      <div className="row-actions">
        <button type="submit" className="btn" disabled={pending}>{pending ? 'Moving…' : 'Move booking'}</button>
        <button type="button" className="btn btn-outline" disabled={pending} onClick={onClose}>Close</button>
      </div>
    </form>
  )
}
