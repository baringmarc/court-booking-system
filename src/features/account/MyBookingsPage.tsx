import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { formatHour, formatMoney } from '../../lib/format'
import { formatDateLabel, hourInZone, todayInZone } from '../../lib/time'
import { useAuth } from '../auth/useAuth'
import { useVenueSettings } from '../catalog/hooks'
import { displayStatus, STATUS_LABELS } from '../booking/status'
import { useNow } from '../booking/useNow'
import type { MyBooking } from './api'
import { useClaimGuestBookings, useMyBookings } from './hooks'
import { MY_SORTS, mySortFromParams, splitMyBookings, type MySort } from './myBookings'

export function MyBookingsPage() {
  const { user } = useAuth()
  const settings = useVenueSettings()
  const bookings = useMyBookings(user?.id)
  const claim = useClaimGuestBookings()
  const now = useNow(60_000) // upcoming vs past only changes on the minute
  const [params, setParams] = useSearchParams()
  const sort = mySortFromParams(params)
  const [noticeDismissed, setNoticeDismissed] = useState(false)

  return (
    <section className="page">
      <h1>My bookings</h1>
      {claim.data && !noticeDismissed ? (
        <div className="alert alert-info" role="status">
          <p>We added {claim.data} earlier {claim.data === 1 ? 'booking' : 'bookings'} made with your email.</p>
          <button type="button" className="btn btn-small btn-ghost" onClick={() => setNoticeDismissed(true)}>Dismiss</button>
        </div>
      ) : null}
      {settings.isPending || bookings.isPending ? (
        <PageLoader />
      ) : settings.isError ? (
        <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} />
      ) : bookings.isError ? (
        <ErrorMessage error={bookings.error} onRetry={() => bookings.refetch()} />
      ) : bookings.data.length === 0 ? (
        <div className="card stack">
          <p>You have no bookings yet.</p>
          <div><Link to="/book" className="btn">Book a court</Link></div>
        </div>
      ) : (
        <BookingLists rows={bookings.data} now={now} timeZone={settings.data.timezone} currency={settings.data.currency}
          sort={sort} onSort={(next) => setParams(next === 'play' ? {} : { sort: next }, { replace: true })} />
      )}
    </section>
  )
}

type ListsProps = { rows: MyBooking[]; now: Date; timeZone: string; currency: string; sort: MySort; onSort: (sort: MySort) => void }

function BookingLists({ rows, now, timeZone, currency, sort, onSort }: ListsProps) {
  const { upcoming, past } = splitMyBookings(rows, now, sort)
  return (
    <div className="stack">
      <div className="field my-sort">
        <label htmlFor="my-sort">Sort by</label>
        <select id="my-sort" value={sort} onChange={(e) => onSort(e.target.value as MySort)}>
          {MY_SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <section className="stack" aria-labelledby="upcoming-heading">
        <h2 id="upcoming-heading">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="muted">Nothing coming up. <Link to="/book">Book a court</Link></p>
        ) : (
          <BookingList label="Upcoming bookings" rows={upcoming} all={rows} now={now} timeZone={timeZone} currency={currency} />
        )}
      </section>
      {past.length > 0 && (
        <section className="stack" aria-labelledby="past-heading">
          <h2 id="past-heading">Past</h2>
          <BookingList label="Past bookings" rows={past} all={rows} now={now} timeZone={timeZone} currency={currency} />
        </section>
      )}
    </div>
  )
}

function BookingList({ label, rows, now, timeZone, currency, all }: { label: string; rows: MyBooking[]; now: Date; timeZone: string; currency: string; all: MyBooking[] }) {
  return (
    <ul className="list card flush" aria-label={label}>
      {rows.map((b) => {
        const status = displayStatus(b, now)
        const date = todayInZone(timeZone, new Date(b.slot_start))
        // A moved part says which booking it came from (T10.10); the parent may be in the other list.
        const parent = b.parent_booking_id ? all.find((r) => r.id === b.parent_booking_id) : null
        return (
          <li key={b.id}>
            <Link to={`/booking/${b.reference_code}`} className="list-row">
              <span>
                <strong>{b.court_name}</strong>
                <span className="muted small block">
                  {formatDateLabel(date, timeZone)}, {formatHour(hourInZone(b.slot_start, timeZone))}–{formatHour(hourInZone(b.slot_end, timeZone))} · {b.reference_code}
                  {b.parent_booking_id ? ` · Moved part${parent ? ` of ${parent.reference_code}` : ''}` : ''}
                </span>
              </span>
              <span className="list-row-end">
                <span>{formatMoney(b.amount_due, currency)}</span>
                <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
