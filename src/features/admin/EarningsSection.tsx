import { useId, useState, type ReactNode } from 'react'
import { DatePicker } from '../../components/DatePicker'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { formatMoney } from '../../lib/format'
import { addDays, formatDateLabel } from '../../lib/time'
import { METHOD_LABELS } from '../booking/proofInput'
import { SPORT_LABELS } from '../catalog/api'
import {
  barShares, change, formatHours, formatShare, occupancy, parseEarnings, periodRange, previousLabel, rangeDays,
  rangeProblem, type DateRange, type Earnings, type HourTotals, type Period,
} from './earnings'
import { useEarnings } from './hooks'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
]

type Props = {
  /** The venue's operating "today" (as on the rest of the dashboard). */
  today: string
  timeZone: string
  currency: string
}

/**
 * Earnings for a period (T10.7, from get_earnings): money collected per method against the period before, booked
 * hours and occupancy per court and sport, a bar per day, and bookings still to come. Money is counted by the date it
 * came in; hours by operating day (SPEC §10).
 */
export function EarningsSection({ today, timeZone, currency }: Props) {
  const headingId = useId()
  const [period, setPeriod] = useState<Period>('today')
  const [custom, setCustom] = useState<DateRange>({ from: addDays(today, -29), to: today })
  const range = periodRange(period, today, custom)
  const problem = period === 'custom' ? rangeProblem(range) : null
  const earnings = useEarnings(range.from, range.to, !problem)
  const label = (d: string) => formatDateLabel(d, timeZone)

  return (
    <section className="card stack" aria-labelledby={headingId}>
      <h2 id={headingId}>Earnings</h2>
      <div className="day-picker" role="group" aria-label="Period">
        {PERIODS.map((p) => (
          <button key={p.value} type="button" className={`day${period === p.value ? ' on' : ''}`} aria-pressed={period === p.value}
            onClick={() => setPeriod(p.value)}>
            {p.label}
          </button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="form-grid">
          <DatePicker label="From" value={custom.from} today={today} timeZone={timeZone}
            onChange={(from) => setCustom((c) => ({ ...c, from }))} />
          <DatePicker label="To" value={custom.to} today={today} timeZone={timeZone}
            onChange={(to) => setCustom((c) => ({ ...c, to }))} />
        </div>
      )}
      <p className="muted small">
        {range.from === range.to ? label(range.from) : `${label(range.from)} – ${label(range.to)}`}
      </p>

      {problem ? (
        <p className="form-error" role="alert">{problem}</p>
      ) : earnings.isPending ? (
        <PageLoader />
      ) : earnings.isError ? (
        <ErrorMessage error={earnings.error} onRetry={() => earnings.refetch()} />
      ) : (
        <EarningsBody earnings={parseEarnings(earnings.data)} period={period} days={rangeDays(range)} currency={currency}
          timeZone={timeZone} />
      )}
    </section>
  )
}

type BodyProps = { earnings: Earnings; period: Period; days: number; currency: string; timeZone: string }

function EarningsBody({ earnings, period, days, currency, timeZone }: BodyProps) {
  const { collected, previous, refundsDue, comingUp } = earnings
  const delta = change(collected.total, previous.total)
  const before = previousLabel(period, days)
  const money = (n: number) => formatMoney(n, currency)

  return (
    <>
      <div className="dash-cards">
        <section>
          <h3>Collected</h3>
          <p className="big-number">{money(collected.total)}</p>
          <p className="small muted">
            {delta.diff === 0
              ? `The same as ${before}.`
              : `${money(Math.abs(delta.diff))} ${delta.diff > 0 ? 'more' : 'less'} than ${before}${delta.percent !== null ? ` (${delta.diff > 0 ? '+' : ''}${delta.percent}%)` : ''}.`}
          </p>
          {collected.byMethod.length > 0 ? (
            <ul className="list" aria-label="Collected by method">
              {collected.byMethod.map((m) => (
                <li key={m.method} className="list-row">
                  <span>{METHOD_LABELS[m.method] ?? m.method} <span className="muted small">({m.count})</span></span>
                  <span>{money(m.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nothing collected in this period.</p>
          )}
          {refundsDue.count > 0 && (
            <p className="form-warning" role="status">
              Also received online but not accepted: {money(refundsDue.total)} ({refundsDue.count}{' '}
              {refundsDue.count === 1 ? 'payment' : 'payments'}). Not in the total; refund outside the app.
            </p>
          )}
          {/* M11+: the Plotline fees line goes here, under the collected total. */}
        </section>
        <section>
          <h3>Coming up</h3>
          <p className="big-number">{comingUp.count}</p>
          <p className="small muted">
            {comingUp.count === 1 ? 'confirmed booking' : 'confirmed bookings'} not played yet, worth {money(comingUp.value)}.
          </p>
        </section>
      </div>

      <HoursTable earnings={earnings} />

      {days > 1 && <DailyChart earnings={earnings} money={money} timeZone={timeZone} />}
    </>
  )
}

function HoursTable({ earnings }: { earnings: Earnings }) {
  const total: HourTotals = earnings.courts.reduce(
    (t, c) => ({
      openHours: t.openHours + c.openHours, blackoutHours: t.blackoutHours + c.blackoutHours,
      soldHours: t.soldHours + c.soldHours, openPlayHours: t.openPlayHours + c.openPlayHours,
    }),
    { openHours: 0, blackoutHours: 0, soldHours: 0, openPlayHours: 0 },
  )
  if (earnings.courts.length === 0) return <p className="muted">No active courts.</p>
  const cells = (h: HourTotals) => (
    <>
      <td>{formatHours(h.soldHours)}</td>
      <td>{formatShare(occupancy(h))}</td>
      <td>{formatHours(h.openPlayHours)}</td>
    </>
  )

  return (
    <section>
      <h3>Booked hours</h3>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Booked hours by court">
        <table className="data-table">
          <thead>
            <tr><th scope="col">Court</th><th scope="col">Booked</th><th scope="col">Occupancy</th><th scope="col">Open play</th></tr>
          </thead>
          <tbody>
            {earnings.sports.map((s) => (
              <SportRows key={s.sport} sport={s} courts={earnings.courts.filter((c) => c.sport === s.sport)} cells={cells}
                showTotal={earnings.sports.length > 1} />
            ))}
          </tbody>
          <tfoot>
            <tr><th scope="row">All courts</th>{cells(total)}</tr>
          </tfoot>
        </table>
      </div>
      <p className="muted small">
        Occupancy is booked hours out of the hours open, minus blackouts. Open play is shown apart and isn't counted as booked. Only courts open for booking now are counted.
      </p>
    </section>
  )
}

type SportRowsProps = {
  sport: Earnings['sports'][number]
  courts: Earnings['courts']
  cells: (h: HourTotals) => ReactNode
  showTotal: boolean
}

function SportRows({ sport, courts, cells, showTotal }: SportRowsProps) {
  return (
    <>
      {courts.map((c) => <tr key={c.courtId}><th scope="row">{c.name}</th>{cells(c)}</tr>)}
      {showTotal && <tr className="subtotal"><th scope="row">All {SPORT_LABELS[sport.sport]?.toLowerCase() ?? sport.sport}</th>{cells(sport)}</tr>}
    </>
  )
}

/** One labelled bar per day, so the chart reads without colour and the text is its own alternative. */
function DailyChart({ earnings, money, timeZone }: { earnings: Earnings; money: (n: number) => string; timeZone: string }) {
  const shares = barShares(earnings.daily.map((d) => d.collected))
  return (
    <section>
      <h3>Collected per day</h3>
      {earnings.daily.every((d) => d.collected === 0) && <p className="muted small">No payments in this period yet.</p>}
      <ul className="bar-chart" aria-label="Collected per day">
        {earnings.daily.map((d, i) => (
          <li key={d.date}>
            <span className="bar-label">{formatDateLabel(d.date, timeZone)}</span>
            <span className="bar-track" aria-hidden="true"><span className="bar" style={{ width: `${shares[i] * 100}%` }} /></span>
            <span className="bar-value">{money(d.collected)} <span className="muted">· {formatHours(d.soldHours)}</span></span>
          </li>
        ))}
      </ul>
    </section>
  )
}
