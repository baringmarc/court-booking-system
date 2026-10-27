import { useMemo, useState } from 'react'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { useAvailability } from '../booking/hooks'
import type { Slot } from '../booking/selection'
import type { Court } from '../catalog/api'
import { useCreateWalkIn } from './hooks'
import { WalkInForm } from './WalkInForm'

type Props = { today: string; courts: Court[]; now: Date; timeZone: string; currency: string }

/** The dashboard's "+ Walk-in" card. Only loaded when VITE_FEATURE_WALK_INS is on (DashboardPage). */
export function WalkInSection({ today, courts, now, timeZone, currency }: Props) {
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
        <WalkInPanel today={today} courts={courts} now={now} timeZone={timeZone} currency={currency}
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
    <WalkInForm courts={courts} slotsByCourt={slotsByCourt} now={now} timeZone={timeZone} currency={currency} date={today}
      pending={create.isPending} error={create.isError ? create.error : null}
      onSubmit={(input) => create.mutate(input, { onSuccess: (r) => onRecorded(r.referenceCode) })} />
  )
}
