import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { formatHour } from '../../lib/format'
import { addDays, formatDateLabel, hourInZone, zonedLocalToISO } from '../../lib/time'
import { useAvailability } from '../booking/hooks'
import { useUpcomingOpenPlay } from '../openPlay/hooks'
import { displayStatus, STATUS_LABELS } from '../booking/status'
import { useNow } from '../booking/useNow'
import type { Court, OperatingHours, VenueSettings } from '../catalog/api'
import { useCourts, useOperatingHours, useVenueSettings } from '../catalog/hooks'
import { isAfterMidnight, operatingDayRange, operatingToday } from '../catalog/hours'
import { operatingDayBookings } from './dashboard'
import { useAdminBookings, useProofQueueCount } from './hooks'
import { DayView } from './DayView'
import { EarningsSection } from './EarningsSection'

// Walk-ins are off unless the build sets VITE_FEATURE_WALK_INS=true. The flag is read inline here, not through a
// shared constant: only an inline `import.meta.env` check is folded at build time, which drops the WalkInSection
// chunk from the bundle (a constant exported from another module left the chunk in dist/).
const WalkInSection = import.meta.env.VITE_FEATURE_WALK_INS === 'true'
  ? lazy(() => import('./WalkInSection').then((m) => ({ default: m.WalkInSection })))
  : null

export function DashboardPage() {
  const settings = useVenueSettings()
  const courts = useCourts()
  const hours = useOperatingHours()

  return (
    <section className="page">
      <h1>Dashboard</h1>
      {settings.isPending || courts.isPending || hours.isPending ? (
        <PageLoader />
      ) : settings.isError ? (
        <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} />
      ) : courts.isError ? (
        <ErrorMessage error={courts.error} onRetry={() => courts.refetch()} />
      ) : hours.isError ? (
        <ErrorMessage error={hours.error} onRetry={() => hours.refetch()} />
      ) : (
        <Dashboard settings={settings.data} courts={courts.data} hours={hours.data} />
      )}
    </section>
  )
}

const ACTIVE = new Set(['pending_payment', 'payment_submitted', 'confirmed', 'completed'])

function Dashboard({ settings, courts, hours }: { settings: VenueSettings; courts: Court[]; hours: OperatingHours[] }) {
  const tz = settings.timezone
  const currency = settings.currency
  const now = useNow(30_000)
  // "Today" is the operating day running now (T9.10): at 1 AM after a 6 AM–5 AM day, still yesterday's date.
  // Earnings count money on that calendar date (money is counted by day).
  const today = operatingToday(hours, tz, now)
  const dayEnd = zonedLocalToISO(`${addDays(today, 1)}T00:00`, tz)
  const open = operatingDayRange(hours, today, tz)
  const pastMidnight = !!open && open.end > dayEnd

  const schedule = useAdminBookings({ status: 'all', source: 'all', date: today, q: '', sort: null }, tz)
  // An overnight day also has bookings on the next calendar date.
  const scheduleNext = useAdminBookings({ status: 'all', source: 'all', date: addDays(today, 1), q: '', sort: null }, pastMidnight ? tz : undefined)
  const availability = useAvailability(today)
  const openPlay = useUpcomingOpenPlay({ enabled: !!availability.data?.some((s) => s.status === 'open_play') })
  const queue = useProofQueueCount()

  const schedulePending = schedule.isPending || (pastMidnight && scheduleNext.isPending)
  const scheduleError = schedule.error ?? (pastMidnight ? scheduleNext.error : null)
  const retrySchedule = () => { schedule.refetch(); if (pastMidnight) scheduleNext.refetch() }
  // The operating day's bookings, each once (one crossing midnight is in both lists), within its open hours.
  const todays = operatingDayBookings(
    [schedule.data?.bookings ?? [], pastMidnight ? scheduleNext.data?.bookings ?? [] : []], open,
  ).filter((b) => ACTIVE.has(displayStatus(b, now)))

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
      </div>

      {WalkInSection && (
        <Suspense fallback={<PageLoader />}>
          <WalkInSection today={today} courts={courts} now={now} timeZone={tz} currency={currency} />
        </Suspense>
      )}

      <EarningsSection today={today} timeZone={tz} currency={currency} />

      <section className="card stack" aria-labelledby="day-view-heading">
        <h2 id="day-view-heading">Today's courts</h2>
        {availability.isPending || schedulePending ? <PageLoader /> : availability.isError ? (
          <ErrorMessage error={availability.error} onRetry={() => availability.refetch()} />
        ) : scheduleError ? (
          <ErrorMessage error={scheduleError} onRetry={retrySchedule} />
        ) : (
          <DayView date={today} courts={courts} slots={availability.data} bookings={todays} timeZone={tz}
            sessionTitle={(id) => openPlay.data?.find((s) => s.id === id)?.title} />
        )}
      </section>

      <section className="card">
        <h2>Today's schedule · {formatDateLabel(today, tz)}</h2>
        {schedulePending ? <PageLoader /> : scheduleError ? (
          <ErrorMessage error={scheduleError} onRetry={retrySchedule} />
        ) : todays.length === 0 ? (
          <p className="muted">No bookings today.</p>
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
    </div>
  )
}
