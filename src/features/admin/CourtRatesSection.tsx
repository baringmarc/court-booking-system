import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { PageLoader } from '../../components/PageLoader'
import { ErrorMessage } from '../../components/ErrorMessage'
import { SaveStatus } from '../../components/SaveStatus'
import { useCourtRates, useOperatingHours, useSaveCourtRates, useVenueSettings } from '../catalog/hooks'
import type { Court, CourtRate, OperatingHours, RateChanges } from '../catalog/api'
import { DAY_NAMES, DAY_SHORT, DISPLAY_DAY_ORDER, formatHour, formatMoney, hourOf } from '../../lib/format'

/** Loads rates + hours, owns the save mutation, and remounts the editor whenever fresh rates arrive. */
export function CourtRatesSection({ court }: { court: Court }) {
  const rates = useCourtRates(court.id)
  const hours = useOperatingHours()
  const currency = useVenueSettings().data?.currency ?? 'PHP'
  const save = useSaveCourtRates(court.id)

  return (
    <section className="card stack">
      <div>
        <h2>Rates</h2>
        <p className="muted small">
          Leave a cell empty to use the default rate ({formatMoney(court.default_hourly_rate, currency)}/hr).
          Filled cells override it for that hour.
        </p>
      </div>
      {rates.isPending || hours.isPending ? (
        <PageLoader />
      ) : rates.isError || hours.isError ? (
        <ErrorMessage
          error={rates.error ?? hours.error}
          onRetry={() => {
            rates.refetch()
            hours.refetch()
          }}
        />
      ) : (
        <RateGridEditor
          key={rates.dataUpdatedAt}
          defaultRate={court.default_hourly_rate}
          courtId={court.id}
          rates={rates.data}
          hours={hours.data}
          saving={save.isPending}
          status={<SaveStatus isSuccess={save.isSuccess} error={save.error} />}
          onEdit={() => save.isSuccess && save.reset()}
          onSave={(changes) => save.mutate(changes)}
        />
      )}
    </section>
  )
}

const cellKey = (day: number, hour: number) => `${day}:${hour}`

type EditorProps = {
  courtId: string
  defaultRate: number
  rates: CourtRate[]
  hours: OperatingHours[]
  saving: boolean
  status: ReactNode
  onEdit: () => void
  onSave: (changes: RateChanges) => void
}

function RateGridEditor({ courtId, defaultRate, rates, hours, saving, status, onEdit, onSave }: EditorProps) {
  const original = useMemo(
    () => new Map(rates.map((r) => [cellKey(r.day_of_week, r.start_hour), r.price])),
    [rates],
  )
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries([...original].map(([k, price]) => [k, String(price)])),
  )
  const [error, setError] = useState<string | null>(null)

  // Which hours each day is open; the grid spans the earliest open to the latest close.
  const openByDay = useMemo(() => {
    const map = new Map<number, [number, number]>()
    for (const h of hours) if (!h.is_closed) map.set(h.day_of_week, [hourOf(h.open_time), hourOf(h.close_time)])
    return map
  }, [hours])
  const spans = [...openByDay.values()]
  const firstHour = spans.length ? Math.min(...spans.map(([o]) => o)) : 0
  const lastHour = spans.length ? Math.max(...spans.map(([, c]) => c)) : 0
  const gridHours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i)
  const isOpen = (day: number, hour: number) => {
    const span = openByDay.get(day)
    return !!span && hour >= span[0] && hour < span[1]
  }

  function setCell(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }))
    onEdit()
  }

  function applyFill(days: number[], from: number, to: number, price: string) {
    setValues((v) => {
      const next = { ...v }
      for (const day of days) for (let h = from; h < to; h++) if (isOpen(day, h)) next[cellKey(day, h)] = price
      return next
    })
    onEdit()
  }

  const isDirty = (key: string) => {
    const v = values[key]?.trim() ?? ''
    const o = original.get(key)
    return v === '' ? o !== undefined : Number(v) !== o
  }

  function handleSave() {
    const changes: RateChanges = { upserts: [], deletes: [] }
    for (const key of new Set([...original.keys(), ...Object.keys(values)])) {
      if (!isDirty(key)) continue
      const [day, hour] = key.split(':').map(Number)
      const raw = values[key]?.trim() ?? ''
      if (raw === '') {
        changes.deletes.push({ day_of_week: day, start_hour: hour })
        continue
      }
      const price = Number(raw)
      if (!Number.isFinite(price) || price < 0) {
        setError(`Invalid price "${raw}" on ${DAY_NAMES[day]} at ${formatHour(hour)}.`)
        return
      }
      changes.upserts.push({ court_id: courtId, day_of_week: day, start_hour: hour, price })
    }
    setError(null)
    onSave(changes)
  }

  const dirtyCount = [...new Set([...original.keys(), ...Object.keys(values)])].filter(isDirty).length

  if (gridHours.length === 0) {
    return <p className="muted">The venue is closed every day. Set operating hours on the Schedule page first.</p>
  }

  return (
    <>
      <FillTool firstHour={firstHour} lastHour={lastHour} onApply={applyFill} />

      <div className="table-scroll">
        <table className="rate-grid">
          <thead>
            <tr>
              <th scope="col">Time</th>
              {DISPLAY_DAY_ORDER.map((d) => <th key={d} scope="col">{DAY_SHORT[d]}</th>)}
            </tr>
          </thead>
          <tbody>
            {gridHours.map((hour) => (
              <tr key={hour}>
                <th scope="row">{formatHour(hour)}</th>
                {DISPLAY_DAY_ORDER.map((day) => {
                  const key = cellKey(day, hour)
                  if (!isOpen(day, hour)) return <td key={day} className="cell-closed" aria-label="Closed">—</td>
                  return (
                    <td key={day} className={isDirty(key) ? 'cell-dirty' : values[key] ? 'cell-set' : undefined}>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        placeholder={String(defaultRate)}
                        aria-label={`${DAY_NAMES[day]} ${formatHour(hour)}`}
                        value={values[key] ?? ''}
                        onChange={(e) => setCell(key, e.target.value)}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={handleSave} disabled={saving || dirtyCount === 0}>
          {saving ? 'Saving…' : dirtyCount ? `Save ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}` : 'No changes'}
        </button>
        {status}
      </div>
    </>
  )
}

function FillTool({
  firstHour,
  lastHour,
  onApply,
}: {
  firstHour: number
  lastHour: number
  onApply: (days: number[], from: number, to: number, price: string) => void
}) {
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [from, setFrom] = useState(firstHour)
  const [to, setTo] = useState(lastHour)
  const [price, setPrice] = useState('')

  const hourOptions = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i)
  const toggleDay = (d: number) => setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]))

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onApply(days, from, to, price.trim())
  }

  return (
    <details className="fill-tool">
      <summary>Fill a range</summary>
      <form className="stack" onSubmit={handleSubmit}>
        <fieldset className="day-picker">
          <legend className="sr-only">Days</legend>
          {DISPLAY_DAY_ORDER.map((d) => (
            <label key={d} className={days.includes(d) ? 'day on' : 'day'}>
              <input type="checkbox" checked={days.includes(d)} onChange={() => toggleDay(d)} />
              {DAY_SHORT[d]}
            </label>
          ))}
        </fieldset>
        <div className="form-grid">
          <label className="field">
            <span>From</span>
            <select value={from} onChange={(e) => setFrom(Number(e.target.value))}>
              {hourOptions.slice(0, -1).map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Until</span>
            <select value={to} onChange={(e) => setTo(Number(e.target.value))}>
              {hourOptions.slice(1).map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Price (empty = default)</span>
            <input type="number" min={0} step="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
        </div>
        <div>
          <button type="submit" className="btn btn-small btn-outline" disabled={days.length === 0 || from >= to}>
            Apply to grid
          </button>
          <span className="muted small"> Then review and save below.</span>
        </div>
      </form>
    </details>
  )
}
