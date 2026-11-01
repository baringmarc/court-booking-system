import { Link } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { formatMoney, formatMoneyExact } from '../../lib/format'
import { METHOD_LABELS } from '../booking/proofInput'
import { useVenueSettings } from '../catalog/hooks'
import type { VenueStatement } from './api'
import { useStatement } from './hooks'

const monthLabel = (date: string) =>
  new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))

function methodLabel(method: string | null, paidWith: string | null) {
  if (paidWith) return paidWith
  return method ? (METHOD_LABELS[method as keyof typeof METHOD_LABELS] ?? method) : 'No payment recorded'
}

/** The venue admin's statement (SAAS-PLAN §5): this month's Plotline charges and past invoices. */
export function StatementPage() {
  const statement = useStatement()
  const settings = useVenueSettings()
  return (
    <section className="page">
      <h1>Statement</h1>
      {statement.isPending || settings.isPending ? (
        <PageLoader />
      ) : statement.isError ? (
        <ErrorMessage error={statement.error} onRetry={() => statement.refetch()} />
      ) : settings.isError ? (
        <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} />
      ) : (
        <Statement data={statement.data} currency={settings.data.currency} />
      )}
    </section>
  )
}

function Statement({ data, currency }: { data: VenueStatement; currency: string }) {
  const money = (n: number) => formatMoneyExact(n, currency)
  return (
    <>
      <section>
        <h2>{monthLabel(data.month)}</h2>
        <dl>
          <div>
            <dt>Booking fees ({data.fee_count})</dt>
            <dd>{formatMoney(data.fee_total, currency)}</dd>
          </div>
          <div>
            <dt>Venue cancellations credited</dt>
            <dd>{formatMoney(data.adjustment_total, currency)}</dd>
          </div>
          <div>
            <dt>Running total</dt>
            <dd>{formatMoney(data.total, currency)}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h2>By payment method</h2>
        {data.by_method.length === 0 ? (
          <p>Nothing to group yet.</p>
        ) : (
          <ul>
            {data.by_method.map((m) => (
              <li key={`${m.method}|${m.paid_with}`}>
                {methodLabel(m.method, m.paid_with)}: {m.count} · {formatMoney(m.fee_total, currency)}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2>Charges</h2>
        {data.lines.length === 0 ? (
          <p>No charges yet this month.</p>
        ) : (
          <ul>
            {data.lines.map((l) => (
              <li key={l.charge_id}>
                <Link to="/admin/bookings">{l.reference_code}</Link> · {l.kind === 'adjustment' ? 'Venue cancellation' : 'Booking fee'} ·{' '}
                {money(l.amount)}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2>Past invoices</h2>
        {data.invoices.length === 0 ? (
          <p>No invoices yet.</p>
        ) : (
          <ul>
            {data.invoices.map((i) => (
              <li key={i.invoice_id}>
                {i.billing_month === data.month ? 'This month' : monthLabel(i.billing_month)} · {i.status} · {money(i.total)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
