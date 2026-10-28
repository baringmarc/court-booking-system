import { useId, useState } from 'react'
import { DatePicker } from '../../components/DatePicker'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { formatMoney } from '../../lib/format'
import { errorMessage } from '../../lib/errors'
import { addDays, formatDateLabel, zonedLocalToISO } from '../../lib/time'
import { METHOD_LABELS } from '../booking/proofInput'
import { SPORT_LABELS } from '../catalog/api'
import {
  barShares, change, formatHours, formatShare, hourBar, occupancy, parseEarnings, periodRange, previousLabel, rangeDays,
  rangeProblem, type DateRange, type Earnings, type HourTotals, type Period,
} from './earnings'
import { bookingsCsv, downloadCsv, paymentsCsv } from './csv'
import { useEarnings, useExportRows } from './hooks'

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
      {!problem && <CsvExport range={range} timeZone={timeZone} currency={currency} />}
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

/**
 * Booked hours (T11.5, the user's "split bars"): a row per court, grouped by sport, then all courts. Each row has a bar
 * of its bookable hours split into booked, open play and free, and the same numbers as text, so nothing relies on
 * the bar or its colors.
 */
function HoursTable({ earnings }: { earnings: Earnings }) {
  const titleId = useId()
  const total: HourTotals = earnings.courts.reduce(
    (t, c) => ({
      openHours: t.openHours + c.openHours, blackoutHours: t.blackoutHours + c.blackoutHours,
      soldHours: t.soldHours + c.soldHours, openPlayHours: t.openPlayHours + c.openPlayHours,
    }),
    { openHours: 0, blackoutHours: 0, soldHours: 0, openPlayHours: 0 },
  )
  if (earnings.courts.length === 0) return <p className="muted">No active courts.</p>
  const several = earnings.sports.length > 1

  return (
    <section className="hours" aria-labelledby={titleId}>
      <h3 id={titleId}>Booked hours</h3>
      <ul className="hours-legend" aria-hidden="true">
        <li><i className="key-booked" />Booked</li>
        <li><i className="key-open-play" />Open play</li>
        <li><i className="key-free" />Free</li>
      </ul>
      {earnings.sports.map((s) => {
        const label = SPORT_LABELS[s.sport] ?? s.sport
        return (
          <div key={s.sport} className="hours-group">
            <div className="hours-head">
              <h4>{label}</h4>
              {several && <span className="hours-figures">{figures(s)}</span>}
            </div>
            <ul className="booked-list" aria-label={`${label} courts`}>
              {earnings.courts.filter((c) => c.sport === s.sport).map((c) => (
                <li key={c.courtId} className="booked-row">
                  <span className="hours-name">{c.name}</span>
                  <HoursBar hours={c} />
                  <span className="hours-figures">{figures(c)}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      <p className="booked-row hours-total">
        <span className="hours-name">All courts</span>
        <HoursBar hours={total} />
        <span className="hours-figures">{figures(total)}</span>
      </p>
      <p className="muted small">
        Each bar is a court's open hours, minus blackouts. Occupancy is the booked share of those hours. Open play is shown apart and isn't counted as booked. Only courts open for booking now are counted.
      </p>
    </section>
  )
}

/** "52 h booked · 62% · 8 h open play". */
function figures(h: HourTotals) {
  return `${formatHours(h.soldHours)} booked · ${formatShare(occupancy(h))} · ${formatHours(h.openPlayHours)} open play`
}

function HoursBar({ hours }: { hours: HourTotals }) {
  const bar = hourBar(hours)
  const pct = (share: number) => `${Math.round(share * 1000) / 10}%`
  return (
    <span className="hours-bar" role="img"
      aria-label={bar ? `Out of ${formatHours(bar.bookable)} open` : 'No open hours'}>
      {bar && <span className="hours-booked" style={{ width: pct(bar.booked) }} />}
      {bar && <span className="hours-open-play" style={{ width: pct(bar.openPlay) }} />}
    </span>
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

/**
 * CSV files for the selected range (T10.8): bookings by play date and payments by the date the money came in. Phone
 * and email are left out unless asked for (Data Privacy Act proportionality, SPEC §10).
 */
function CsvExport({ range, timeZone, currency }: { range: DateRange; timeZone: string; currency: string }) {
  const [includeContact, setIncludeContact] = useState(false)
  const exportRows = useExportRows()
  const startIso = zonedLocalToISO(`${range.from}T00:00`, timeZone)
  const endIso = zonedLocalToISO(`${addDays(range.to, 1)}T00:00`, timeZone)
  const busy = exportRows.isPending ? exportRows.variables?.kind : null

  function run(kind: 'bookings' | 'payments') {
    exportRows.mutate({ kind, startIso, endIso }, {
      onSuccess: (result) => {
        const name = `${result.kind}_${range.from}_to_${range.to}.csv`
        downloadCsv(name, result.kind === 'bookings'
          ? bookingsCsv(result.bookings, { timeZone, currency, includeContact })
          : paymentsCsv(result.payments, { timeZone, currency }))
      },
    })
  }

  return (
    <section className="stack">
      <h3>Export</h3>
      <label className="check">
        <input type="checkbox" checked={includeContact} onChange={(e) => setIncludeContact(e.target.checked)} />
        <span>Include contact details (phone, email) in the bookings file</span>
      </label>
      <div className="form-actions">
        <button type="button" className="btn btn-small btn-outline" disabled={!!busy} onClick={() => run('bookings')}>
          {busy === 'bookings' ? 'Preparing…' : 'Export bookings (CSV)'}
        </button>
        <button type="button" className="btn btn-small btn-outline" disabled={!!busy} onClick={() => run('payments')}>
          {busy === 'payments' ? 'Preparing…' : 'Export payments (CSV)'}
        </button>
      </div>
      {exportRows.isError && <p className="form-error" role="alert">{errorMessage(exportRows.error)}</p>}
      <p className="muted small">
        Bookings by play date, payments by the date the money came in, times in {timeZone}. The files contain personal
        data: store them securely and delete them when you no longer need them.
      </p>
    </section>
  )
}
