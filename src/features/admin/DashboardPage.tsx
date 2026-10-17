import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { formatHour, formatMoney } from '../../lib/format'
import { addDays, formatDateLabel, hourInZone, todayInZone, zonedLocalToISO } from '../../lib/time'
import { useAvailability } from '../booking/hooks'
import { METHOD_LABELS } from '../booking/proofInput'
import type { Slot } from '../booking/selection'
import { displayStatus, STATUS_LABELS } from '../booking/status'
import { useNow } from '../booking/useNow'
import type { Court, VenueSettings } from '../catalog/api'
import { useCourts, useVenueSettings } from '../catalog/hooks'
import { takingsByMethod } from './dashboard'
import { useAdminBookings, useCreateWalkIn, useProofQueueCount, useTakings } from './hooks'
import { WalkInForm } from './WalkInForm'

export function DashboardPage() {
  const settings = useVenueSettings()
  const courts = useCourts()

  return (
    <section className="page">
      <h1>Dashboard</h1>
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

function Dashboard({ settings, courts }: { settings: VenueSettings; courts: Court[] }) {
  const tz = settings.timezone
  const currency = settings.currency
  const today = todayInZone(tz)
  const dayStart = zonedLocalToISO(`${today}T00:00`, tz)
  const dayEnd = zonedLocalToISO(`${addDays(today, 1)}T00:00`, tz)
  const now = useNow(30_000)

  const schedule = useAdminBookings({ status: 'all', source: 'all', date: today }, tz)
  const queue = useProofQueueCount()
  const takings = useTakings(dayStart, dayEnd)
  const [showWalkIn, setShowWalkIn] = useState(false)
  const [lastWalkIn, setLastWalkIn] = useState<string | null>(null)

  const todays = (schedule.data?.bookings ?? []).filter((b) => ACTIVE.has(displayStatus(b, now)))
  const summary = takings.data ? takingsByMethod(takings.data) : null

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
          <h2>Today's takings</h2>
          {takings.isPending ? <PageLoader /> : takings.isError ? (
            <ErrorMessage error={takings.error} onRetry={() => takings.refetch()} />
          ) : summary && summary.rows.length > 0 ? (
            <>
              <p className="big-number">{formatMoney(summary.total, currency)}</p>
              <ul className="list">
                {summary.rows.map((r) => (
                  <li key={r.method} className="list-row"><span>{METHOD_LABELS[r.method]}</span><span>{formatMoney(r.total, currency)}</span></li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">Nothing taken yet today.</p>
          )}
        </section>
      </div>

      <section className="card stack">
        <div className="page-head">
          <h2>Walk-in</h2>
          <button type="button" className="btn btn-small" aria-expanded={showWalkIn} onClick={() => setShowWalkIn((v) => !v)}>
            {showWalkIn ? 'Close' : '+ Walk-in'}
          </button>
        </div>
        {lastWalkIn && <div className="alert alert-info" role="status"><p>Walk-in {lastWalkIn} recorded and confirmed.</p></div>}
        {showWalkIn && (
          <WalkInPanel today={today} courts={courts} now={now} timeZone={tz} currency={currency}
            onRecorded={(ref) => { setLastWalkIn(ref); setShowWalkIn(false) }} />
        )}
      </section>

      <section className="card">
        <h2>Today's schedule · {formatDateLabel(today, tz)}</h2>
        {schedule.isPending ? <PageLoader /> : schedule.isError ? (
          <ErrorMessage error={schedule.error} onRetry={() => schedule.refetch()} />
        ) : todays.length === 0 ? (
          <p className="muted">No bookings today.</p>
        ) : (
          <ul className="list">
            {todays.map((b) => {
              const status = displayStatus(b, now)
              return (
                <li key={b.id} className="list-row">
                  <span>
                    <strong>{formatHour(hourInZone(b.slot_start, tz))}–{formatHour(hourInZone(b.slot_end, tz))}</strong> · {b.court_name}
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

type WalkInPanelProps = {
  today: string
  courts: Court[]
  now: Date
  timeZone: string
  currency: string
  onRecorded: (referenceCode: string) => void
}

function WalkInPanel({ today, courts, now, timeZone, currency, onRecorded }: WalkInPanelProps) {
  const availability = useAvailability(today)
  const create = useCreateWalkIn()
  const slotsByCourt = useMemo(() => {
    const map = new Map<string, Slot[]>()
    for (const s of availability.data ?? []) map.set(s.court_id, [...(map.get(s.court_id) ?? []), s])
    return map
  }, [availability.data])

  if (availability.isPending) return <PageLoader />
  if (availability.isError) return <ErrorMessage error={availability.error} onRetry={() => availability.refetch()} />
  if (courts.length === 0 || availability.data.length === 0) return <p className="muted">The venue is closed today.</p>
  return (
    <WalkInForm courts={courts} slotsByCourt={slotsByCourt} now={now} timeZone={timeZone} currency={currency}
      pending={create.isPending} error={create.isError ? create.error : null}
      onSubmit={(input) => create.mutate(input, { onSuccess: (r) => onRecorded(r.referenceCode) })} />
  )
}
