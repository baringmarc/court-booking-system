import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { formatHour } from '../../lib/format'
import { addDays, formatDateLabel, hourInZone, todayInZone, zonedLocalToISO } from '../../lib/time'
import { useAvailability } from '../booking/hooks'
import { useUpcomingOpenPlay } from '../openPlay/hooks'
import { displayStatus, STATUS_LABELS } from '../booking/status'
import { useNow } from '../booking/useNow'
import type { Court, VenueSettings } from '../catalog/api'
import { useCourts, useStaffSchedule, useVenueSettings } from '../catalog/hooks'
import { isAfterMidnight } from '../catalog/hours'
import { nextBooking, operatingDayBookings, todayHoursLabel } from './dashboard'
import { useAdminBookings, useProofQueueCount, useRefundsOwedCount } from './hooks'
import { DEFAULT_FILTERS, filtersToParams } from './bookingFilters'
import { DayView } from './DayView'
import { EarningsSection } from './EarningsSection'
import { SetupChecklist } from './SetupChecklist'
import { PostOpenSlotsDialog } from './PostOpenSlotsDialog'
import { useVenue } from '../venue/useVenue'

// Shown only where Plotline has turned walk-ins on for the venue (T18.4, venue_settings.walk_ins_enabled); the form
// stays in its own lazy chunk inside the admin bundle.
const WalkInSection = lazy(() => import('./WalkInSection').then((m) => ({ default: m.WalkInSection })))

export function DashboardPage() {
  const venue = useVenue()
  const settings = useVenueSettings()
  const courts = useCourts()

  return (
    <section className="page">
      <div className="page-head">
        <h1>Dashboard</h1>
        <a className="btn btn-small btn-outline" href="/guides/venue-owner-manual.pdf" download>Download owner manual (PDF)</a>
      </div>
      {venue.status === 'draft' && <SetupChecklist />}
      {settings.isPending || courts.isPending ? (
        <PageLoader />
      ) : settings.isError ? (
        <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} />
      ) : courts.isError ? (
        <ErrorMessage error={courts.error} onRetry={() => courts.refetch()} />
      ) : (
        <Dashboard settings={settings.data} courts={courts.data} />
      )}
    </section>
  )
}

const ACTIVE = new Set(['pending_payment', 'payment_submitted', 'confirmed', 'completed'])

const DAY_CARDS = ['Proofs to review', "Today's bookings", 'Next booking', 'Refunds owed']

function Dashboard({ settings, courts }: { settings: VenueSettings; courts: Court[] }) {
  const tz = settings.timezone
  const now = useNow(30_000)
  // "Today" is the operating day running now (T9.10), read from the effective schedule (get_staff_schedule, T32.2):
  // at 1 AM after a 6 AM–2 AM day, still yesterday's date. Until both days' periods arrive it isn't known.
  const localDate = todayInZone(tz, now)
  const yesterday = useStaffSchedule(addDays(localDate, -1))
  const current = useStaffSchedule(localDate)
  if (yesterday.isPending || current.isPending || yesterday.isError || current.isError) {
    const failed = yesterday.isError ? yesterday : current.isError ? current : null
    const retry = () => { if (yesterday.isError) yesterday.refetch(); if (current.isError) current.refetch() }
    return (
      <div className="dash-cards">
        {DAY_CARDS.map((title) => (
          <section className="card" key={title}>
            <h2>{title}</h2>
            {failed ? <ErrorMessage error={failed.error} onRetry={retry} /> : <PageLoader />}
          </section>
        ))}
      </div>
    )
  }
  const yesterdayRunning = yesterday.data.some((p) => Date.parse(p.period_start) <= now.getTime() && now.getTime() < Date.parse(p.period_end))
  const today = yesterdayRunning ? addDays(localDate, -1) : localDate
  return <DashboardDay settings={settings} courts={courts} now={now} today={today} />
}

function DashboardDay({ settings, courts, now, today }: { settings: VenueSettings; courts: Court[]; now: Date; today: string }) {
  const tz = settings.timezone
  const currency = settings.currency
  // Earnings count money on today's calendar date (money is counted by day).
  const dayEnd = zonedLocalToISO(`${addDays(today, 1)}T00:00`, tz)
  const staffHours = useStaffSchedule(today)
  const pastMidnight = (staffHours.data ?? []).some((p) => Date.parse(p.period_end) > Date.parse(dayEnd))

  const schedule = useAdminBookings({ status: 'all', source: 'all', date: today, q: '', sort: null }, tz)
  // An overnight day also has bookings on the next calendar date.
  const scheduleNext = useAdminBookings({ status: 'all', source: 'all', date: addDays(today, 1), q: '', sort: null }, pastMidnight ? tz : undefined)
  const availability = useAvailability(today)
  const openPlay = useUpcomingOpenPlay({ enabled: !!availability.data?.some((s) => s.status === 'open_play') })
  const queue = useProofQueueCount()
  const refundsOwed = useRefundsOwedCount()

  const schedulePending = schedule.isPending || staffHours.isPending || (pastMidnight && scheduleNext.isPending)
  const scheduleError = schedule.error ?? staffHours.error ?? (pastMidnight ? scheduleNext.error : null)
  const retrySchedule = () => { schedule.refetch(); staffHours.refetch(); if (pastMidnight) scheduleNext.refetch() }
  // The operating day's bookings, each once (one crossing midnight is in both lists), within its open hours.
  const overnightEnd = Math.max(Date.parse(dayEnd), ...(staffHours.data ?? []).map((p) => Date.parse(p.period_end)))
  const todays = operatingDayBookings(
    [schedule.data?.bookings ?? [], pastMidnight ? (scheduleNext.data?.bookings ?? []).filter((b) => Date.parse(b.slot_start) < overnightEnd) : []], null,
  ).filter((b) => ACTIVE.has(displayStatus(b, now)))
  const next = nextBooking(todays, now)
  const [posting, setPosting] = useState(false)
  const gridReady = courts.length > 0 && !availability.isPending && !availability.isError && !schedulePending && !scheduleError
  // T27.7: each card opens the bookings it counts.
  const todayLink = `/admin/bookings?${filtersToParams({ ...DEFAULT_FILTERS, status: 'all', date: today })}`
  const refundsLink = `/admin/bookings?${filtersToParams({ ...DEFAULT_FILTERS, status: 'all', refund: 'owed' })}`
  const nextLink = next ? `/admin/bookings?${filtersToParams({ ...DEFAULT_FILTERS, q: next.reference_code })}` : '/admin/bookings'

  return (
    <div className="stack">
      <div className="dash-cards">
        <section className="card">
          <h2>Proofs to review</h2>
          {queue.isPending ? <PageLoader /> : queue.isError ? (
            <ErrorMessage error={queue.error} onRetry={() => queue.refetch()} />
          ) : (
            <>
              <p className="big-number">{queue.data}</p>
              <Link to="/admin/bookings">{queue.data ? 'Review proofs' : 'Open bookings'}</Link>
            </>
          )}
        </section>
        <section className="card">
          <h2>Today's bookings</h2>
          {schedulePending ? <PageLoader /> : scheduleError ? (
            <ErrorMessage error={scheduleError} onRetry={retrySchedule} />
          ) : (
            <>
              <p className="big-number">{todays.length}</p>
              <Link to={todayLink}>Open bookings</Link>
            </>
          )}
        </section>
        <section className="card">
          <h2>Next booking</h2>
          {schedulePending ? <PageLoader /> : scheduleError ? (
            <ErrorMessage error={scheduleError} onRetry={retrySchedule} />
          ) : next ? (
            <>
              <p>
                <strong>{formatHour(hourInZone(next.slot_start, tz))}–{formatHour(hourInZone(next.slot_end, tz))}</strong> · {next.court_name}
                <span className="muted small block">{next.guest_name}</span>
              </p>
              <Link to={nextLink}>Open bookings</Link>
            </>
          ) : (
            <>
              <p className="muted">No more bookings today</p>
              <Link to="/admin/bookings">Open bookings</Link>
            </>
          )}
        </section>
        <section className="card">
          <h2>Refunds owed</h2>
          {refundsOwed.isPending ? <PageLoader /> : refundsOwed.isError ? (
            <ErrorMessage error={refundsOwed.error} onRetry={() => refundsOwed.refetch()} />
          ) : (
            <>
              <p className="big-number">{refundsOwed.data}</p>
              <Link to={refundsLink}>Open refunds</Link>
            </>
          )}
        </section>
      </div>

      {settings.walk_ins_enabled && (
        <Suspense fallback={<PageLoader />}>
          <WalkInSection today={today} courts={courts} now={now} timeZone={tz} currency={currency} periods={staffHours.data ?? []} />
        </Suspense>
      )}

      <section className="card stack" aria-labelledby="day-view-heading">
        <div className="page-head">
          <h2 id="day-view-heading">Today's courts</h2>
          {/* T31.1b: the day's open slots as a picture and caption for Facebook, once the grid it mirrors has loaded. */}
          {gridReady && (
            <button type="button" className="btn btn-small" onClick={() => setPosting(true)}>Post open slots</button>
          )}
        </div>
        {courts.length === 0 ? (
          <div>
            <p className="muted">No courts yet.</p>
            <Link to="/admin/courts/new" className="btn btn-small">Add court</Link>
          </div>
        ) : availability.isPending || schedulePending ? <PageLoader /> : availability.isError ? (
          <ErrorMessage error={availability.error} onRetry={() => availability.refetch()} />
        ) : scheduleError ? (
          <ErrorMessage error={scheduleError} onRetry={retrySchedule} />
        ) : (
          <DayView date={today} courts={courts} slots={availability.data} bookings={todays} timeZone={tz}
            sessionTitle={(id) => openPlay.data?.find((s) => s.id === id)?.title} />
        )}
        {posting && <PostOpenSlotsDialog settings={settings} courts={courts} today={today} onClose={() => setPosting(false)} />}
      </section>

      <section className="card">
        <h2>Today's schedule · {formatDateLabel(today, tz)}</h2>
        {schedulePending ? <PageLoader /> : scheduleError ? (
          <ErrorMessage error={scheduleError} onRetry={retrySchedule} />
        ) : todays.length === 0 ? (
          <p className="muted">No bookings today. {todayHoursLabel(staffHours.data ?? [], tz, today)}</p>
        ) : (
          <ul className="list">
            {todays.map((b) => {
              const status = displayStatus(b, now)
              return (
                <li key={b.id} className="list-row">
                  <span>
                    <strong>{formatHour(hourInZone(b.slot_start, tz))}–{formatHour(hourInZone(b.slot_end, tz))}{isAfterMidnight(b.slot_start, today, tz) ? ' (next day)' : ''}</strong> · {b.court_name}
                    <span className="muted small block">{b.guest_name} · {b.reference_code}{b.source === 'walk_in' ? ' · Walk-in' : ''}</span>
                  </span>
                  <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <EarningsSection today={today} timeZone={tz} currency={currency} />
    </div>
  )
}
