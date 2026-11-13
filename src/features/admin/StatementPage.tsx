import { useEffect, useId, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { Pager } from '../../components/Pager'
import { formatMoney, formatMoneyExact } from '../../lib/format'
import { formatInZone, todayInZone } from '../../lib/time'
import { METHOD_LABELS } from '../booking/proofInput'
import { useVenueSettings } from '../catalog/hooks'
import { STATEMENT_PAGE_SIZE, type StatementCharge, type StatementInvoice, type StatementSummary } from './api'
import { useDownloadInvoicePdf, useLocateStatementInvoice, useStatementCharges, useStatementInvoices, useStatementSummary } from './hooks'

/** How many months back the month picker offers, counting the current one. */
const MONTHS_OFFERED = 12

const monthLabel = (date: string) =>
  new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))

function methodLabel(method: string | null, paidWith: string | null) {
  if (paidWith) return paidWith
  return method ? (METHOD_LABELS[method as keyof typeof METHOD_LABELS] ?? method) : 'No payment recorded'
}

const STATUS_LABELS: Record<string, string> = { draft: 'Draft (not issued yet)', sent: 'Sent', paid: 'Paid' }

function pageOf(value: string | null): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 1 ? n : 1
}

/** The first day of the venue-local current month and the `count - 1` months before it, newest first. */
function recentMonths(timeZone: string, count: number): string[] {
  const [year, month] = todayInZone(timeZone).split('-').map(Number)
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(year, month - 1 - i, 1)).toISOString().slice(0, 10))
}

/**
 * The venue admin's statement (SAAS-PLAN §5, T17.22): what is due now (sent invoices), this month's fees so far, one
 * month's totals and paged charges, and the invoice history. View state lives in the URL: `month`, `q` (booking
 * reference), `page` (charges) and `ipage` (invoices); page 1 and blank values stay out of it. `invoice` (the emailed
 * VIEW INVOICE link, T26.7) opens that invoice in the history, on the page it is on unless `ipage` names one.
 */
export function StatementPage() {
  const settings = useVenueSettings()
  return (
    <section className="page statement">
      <h1>Statement</h1>
      {settings.isPending ? (
        <PageLoader />
      ) : settings.isError ? (
        <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} />
      ) : (
        <Statement currency={settings.data.currency} timeZone={settings.data.timezone} />
      )}
    </section>
  )
}

function Statement({ currency, timeZone }: { currency: string; timeZone: string }) {
  const [params, setParams] = useSearchParams()
  const months = recentMonths(timeZone, MONTHS_OFFERED)
  const urlMonth = params.get('month') ?? ''
  const month = /^\d{4}-\d{2}-01$/.test(urlMonth) && urlMonth !== months[0] ? urlMonth : ''
  const search = params.get('q') ?? ''
  const page = pageOf(params.get('page'))
  const linkedInvoice = params.get('invoice') ?? ''
  // Find the linked invoice's page only when the URL doesn't name one; an unknown id leaves the history on page 1.
  const locate = useLocateStatementInvoice(params.has('ipage') ? '' : linkedInvoice)
  const locating = linkedInvoice !== '' && !params.has('ipage')
  const invoicePage = locating ? (locate.data?.page ?? 1) : pageOf(params.get('ipage'))
  const options = month !== '' && !months.includes(month) ? [...months, month].sort().reverse() : months

  const summary = useStatementSummary(month)
  const charges = useStatementCharges({ month, search, page })
  const invoices = useStatementInvoices({ page: invoicePage }, { enabled: !locating || locate.isSuccess })

  /** Sets or clears URL values; a month or search change also starts the charges again at page 1. */
  function update(changes: Record<string, string | number | null>, replace = false) {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === '' || value === 1) next.delete(key)
        else next.set(key, String(value))
      }
      if ('month' in changes || 'q' in changes) next.delete('page')
      return next
    }, { replace })
  }

  return (
    <>
      {summary.isPending ? (
        <PageLoader />
      ) : summary.isError ? (
        <ErrorMessage error={summary.error} onRetry={() => summary.refetch()} />
      ) : (
        <>
          <AmountDue summary={summary.data} currency={currency} timeZone={timeZone} />
          <Accrual summary={summary.data} currency={currency} />
        </>
      )}

      <div className="field statement-month">
        <label htmlFor="statement-month">Month</label>
        <select id="statement-month" value={month || months[0]}
          onChange={(e) => update({ month: e.target.value === months[0] ? null : e.target.value })}>
          {options.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>

      {summary.isSuccess && <MonthTotals summary={summary.data} currency={currency} />}

      <section aria-labelledby="statement-charges">
        <h2 id="statement-charges">Charges</h2>
        <div className="field">
          <label htmlFor="statement-search">Search booking reference</label>
          <input id="statement-search" type="search" value={search} autoComplete="off"
            onChange={(e) => update({ q: e.target.value }, true)} />
        </div>
        {charges.isPending ? (
          <PageLoader />
        ) : charges.isError ? (
          <ErrorMessage error={charges.error} onRetry={() => charges.refetch()} />
        ) : charges.data.total === 0 ? (
          <p className="muted">
            {search.trim() !== '' ? `No charges match “${search.trim()}” this month.` : 'No charges this month.'}
          </p>
        ) : (
          <>
            <ul className="list card flush" aria-label="Charges">
              {charges.data.rows.map((c) => <ChargeRow key={c.charge_id} charge={c} currency={currency} timeZone={timeZone} />)}
            </ul>
            <Pager label="Charges pages" page={page} total={charges.data.total} pageSize={STATEMENT_PAGE_SIZE}
              onPage={(p) => update({ page: p })} />
          </>
        )}
      </section>

      {/* Named as a region once its rows are in, so assistive tech doesn't announce an empty history. */}
      <section aria-labelledby={invoices.isSuccess ? 'statement-invoices' : undefined} aria-busy={invoices.isPending}>
        <h2 id="statement-invoices">Invoice history</h2>
        {locating && locate.isError ? (
          <ErrorMessage error={locate.error} onRetry={() => locate.refetch()} />
        ) : invoices.isPending ? (
          <PageLoader />
        ) : invoices.isError ? (
          <ErrorMessage error={invoices.error} onRetry={() => invoices.refetch()} />
        ) : invoices.data.total === 0 ? (
          <p className="muted">No invoices yet.</p>
        ) : (
          <>
            <ul className="list card flush">
              {invoices.data.rows.map((i) => <InvoiceRow key={i.invoice_id} invoice={i} currency={currency} timeZone={timeZone}
                linked={i.invoice_id === linkedInvoice} />)}
            </ul>
            <Pager label="Invoice pages" page={invoicePage} total={invoices.data.total} pageSize={STATEMENT_PAGE_SIZE}
              onPage={(p) => update({ ipage: p, invoice: null })} />
          </>
        )}
      </section>
    </>
  )
}

const shortDate = (iso: string, timeZone: string) => formatInZone(iso, timeZone, { month: 'short', day: 'numeric', year: 'numeric' })

/** Issued, unpaid invoices: the only amounts the venue owes now. */
function AmountDue({ summary, currency, timeZone }: { summary: StatementSummary; currency: string; timeZone: string }) {
  const due = summary.amount_due
  return (
    <section className="card statement-due" aria-labelledby="statement-due">
      <h2 id="statement-due">Amount due</h2>
      {due.count === 0 ? (
        <p>Nothing is due. Invoices appear here once Plotline sends them.</p>
      ) : (
        <>
          <p className="statement-figure">{formatMoneyExact(due.total, currency)}</p>
          <p className="muted small">Total of sent invoices that are not yet paid ({due.count}).</p>
          <ul className="list">
            {due.invoices.map((i) => (
              <li key={i.invoice_id}>
                {monthLabel(i.billing_month)} · {formatMoneyExact(i.total, currency)} · Due {shortDate(i.due_at, timeZone)}
                {i.overdue && <> <span className="badge review-rejected">Overdue</span></>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/** The current month's running fees: informational until the month is invoiced. */
function Accrual({ summary, currency }: { summary: StatementSummary; currency: string }) {
  const a = summary.accrual
  return (
    <section className="card" aria-labelledby="statement-accrual">
      <h2 id="statement-accrual">This month’s fees so far</h2>
      <p className="statement-figure">{formatMoneyExact(a.total, currency)}</p>
      <p className="muted small">
        {a.fee_count} booking {a.fee_count === 1 ? 'fee' : 'fees'} ({formatMoney(a.fee_total, currency)}) less venue cancellations
        credited ({formatMoney(a.adjustment_total, currency)}). Not yet invoiced, so nothing here is due now.
      </p>
    </section>
  )
}

/** The selected month's full totals, from the summary (never the visible page of charges). */
function MonthTotals({ summary, currency }: { summary: StatementSummary; currency: string }) {
  return (
    <>
      <section aria-labelledby="statement-month-totals">
        <h2 id="statement-month-totals">{monthLabel(summary.month)}</h2>
        <dl>
          <div>
            <dt>Booking fees ({summary.fee_count})</dt>
            <dd>{formatMoneyExact(summary.fee_total, currency)}</dd>
          </div>
          <div>
            <dt>Venue cancellations credited</dt>
            <dd>{formatMoneyExact(summary.adjustment_total, currency)}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{formatMoneyExact(summary.total, currency)}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h2>By payment method</h2>
        {summary.by_method.length === 0 ? (
          <p className="muted">Nothing to group yet.</p>
        ) : (
          <ul>
            {summary.by_method.map((m) => (
              <li key={`${m.method}|${m.paid_with}`}>
                {methodLabel(m.method, m.paid_with)}: {m.count} · {formatMoney(m.fee_total, currency)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

/** A charge links to its booking: the reference search finds it whatever the bookings page's default filter. */
function ChargeRow({ charge, currency, timeZone }: { charge: StatementCharge; currency: string; timeZone: string }) {
  const to = `/admin/bookings?${new URLSearchParams({ q: charge.reference_code, booking: charge.booking_id })}`
  return (
    <li className="list-row">
      <span>
        <Link to={to}>{charge.reference_code}</Link> · {charge.kind === 'adjustment' ? 'Venue cancellation credited' : 'Booking fee'}
        <span className="muted small block">{shortDate(charge.charged_at, timeZone)}</span>
      </span>
      <span className="list-row-end">{formatMoneyExact(charge.amount, currency)}</span>
    </li>
  )
}

/** An invoice in the history; the linked one (`?invoice=`) starts open and is scrolled into view. */
function InvoiceRow({ invoice: i, currency, timeZone, linked }: { invoice: StatementInvoice; currency: string; timeZone: string; linked: boolean }) {
  const [open, setOpen] = useState(linked)
  const detailsId = useId()
  const rowRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (linked) rowRef.current?.scrollIntoView({ block: 'start' })
  }, [linked])
  return (
    <li className="statement-invoice" ref={rowRef}>
      <div className="list-row">
        <span>
          <strong>{monthLabel(i.billing_month)}</strong> · {STATUS_LABELS[i.status] ?? i.status}
          <span className="muted small block">
            {i.status === 'sent' && i.due_at ? `Due ${shortDate(i.due_at, timeZone)}` : null}
            {i.status === 'paid' && i.paid_at
              ? `Paid ${shortDate(i.paid_at, timeZone)}${i.paid_method ? ` by ${i.paid_method}` : ''}${i.paid_reference ? ` (${i.paid_reference})` : ''}`
              : null}
          </span>
        </span>
        <span className="list-row-end">
          <span>{formatMoneyExact(i.total, currency)}</span>
          {i.status === 'sent' && i.overdue && <span className="badge review-rejected">Overdue</span>}
          <button type="button" className="btn btn-ghost btn-small" aria-expanded={open} aria-controls={open ? detailsId : undefined}
            onClick={() => setOpen((o) => !o)}>
            Details
          </button>
          {(i.status === 'sent' || i.status === 'paid') && <DownloadPdf invoice={i} />}
        </span>
      </div>
      {open && (
        <dl id={detailsId} className="statement-invoice-details">
          <div>
            <dt>Booking fees</dt>
            <dd>{formatMoneyExact(i.fee_total, currency)}</dd>
          </div>
          <div>
            <dt>Venue cancellations credited</dt>
            <dd>{formatMoneyExact(i.adjustment_total, currency)}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{formatMoneyExact(i.total, currency)}</dd>
          </div>
        </dl>
      )}
    </li>
  )
}

/** Saves a sent or paid invoice's PDF (T26.7) through a temporary download link; errors stay in the row. */
function DownloadPdf({ invoice }: { invoice: StatementInvoice }) {
  const download = useDownloadInvoicePdf()
  function save() {
    download.mutate(invoice.invoice_id, {
      onSuccess: (blob) => {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `plotline-invoice-${invoice.billing_month.slice(0, 7)}.pdf`
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      },
    })
  }
  return (
    <>
      <button type="button" className="btn btn-ghost btn-small" disabled={download.isPending} onClick={save}>
        Download PDF
      </button>
      {download.isError && <span className="form-error block" role="alert">{download.error.message}</span>}
    </>
  )
}
