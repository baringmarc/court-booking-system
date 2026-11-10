import { useMemo, useState } from 'react'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { useAvailability } from '../booking/hooks'
import type { Slot } from '../booking/selection'
import type { Court, StaffSchedulePeriod } from '../catalog/api'
import { useCreateWalkIn } from './hooks'
import { WalkInForm } from './WalkInForm'

type Props = { today: string; courts: Court[]; now: Date; timeZone: string; currency: string; periods: StaffSchedulePeriod[] }

/** The dashboard's "+ Walk-in" card. Only loaded when the venue has walk-ins on (DashboardPage, T18.4). */
export function WalkInSection({ today, courts, now, timeZone, currency, periods }: Props) {
  const [showWalkIn, setShowWalkIn] = useState(false)
  const [lastWalkIn, setLastWalkIn] = useState<string | null>(null)
  return (
    <section className="card stack">
      <div className="page-head">
        <h2>Walk-in</h2>
        <button type="button" className="btn btn-small" aria-expanded={showWalkIn} onClick={() => setShowWalkIn((v) => !v)}>
          {showWalkIn ? 'Close' : '+ Walk-in'}
        </button>
      </div>
      {lastWalkIn && <div className="alert alert-info" role="status"><p>Walk-in {lastWalkIn} recorded and confirmed.</p></div>}
      {showWalkIn && (
        <WalkInPanel today={today} courts={courts} now={now} timeZone={timeZone} currency={currency} periods={periods}
          onRecorded={(ref) => { setLastWalkIn(ref); setShowWalkIn(false) }} />
      )}
    </section>
  )
}

type WalkInPanelProps = {
  today: string
  courts: Court[]
  now: Date
  timeZone: string
  currency: string
  periods: StaffSchedulePeriod[]
  onRecorded: (referenceCode: string) => void
}

function WalkInPanel({ today, courts, now, timeZone, currency, periods, onRecorded }: WalkInPanelProps) {
  const availability = useAvailability(today)
  const create = useCreateWalkIn()
  const slotsByCourt = useMemo(() => {
    const map = new Map<string, Slot[]>()
    for (const s of availability.data ?? []) {
      const period = periods.find((p) => p.court_id === s.court_id && Date.parse(p.period_start) <= Date.parse(s.slot_start) && Date.parse(s.slot_end) <= Date.parse(p.period_end))
      if (period) map.set(s.court_id, [...(map.get(s.court_id) ?? []), { ...s, period_end: period.period_end }])
    }
    return map
  }, [availability.data, periods])

  if (availability.isPending) return <PageLoader />
  if (availability.isError) return <ErrorMessage error={availability.error} onRetry={() => availability.refetch()} />
  if (courts.length === 0 || availability.data.length === 0) return <p className="muted">The venue is closed today.</p>
  return (
    <WalkInForm courts={courts} slotsByCourt={slotsByCourt} now={now} timeZone={timeZone} currency={currency} date={today}
      pending={create.isPending} error={create.isError ? create.error : null}
      onSubmit={(input) => create.mutate(input, { onSuccess: (r) => onRecorded(r.referenceCode) })} />
  )
}
