import { useState, type FormEvent } from 'react'
import { formatMoneyExact } from '../../lib/format'
import { venueAdminUrl } from '../../lib/venueUrl'
import { CONSOLE_PAGE_SIZE, type InvoiceDetailData } from './api'
import { useInvoiceDetailPage, useMarkInvoicePaid, useMarkInvoiceSent } from './hooks'
import { invoiceNumber } from './invoiceNumber'
import { StatusBadge } from './ListControls'
import { Pager } from './Pager'

/** Where a venue's bookings list lives, from the console's host. */
function bookingsUrl(slug: string): string {
  const url = new URL(venueAdminUrl(slug, window.location), window.location.origin)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/bookings`
  return url.toString()
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
}

const METHODS = ['GCash', 'Bank transfer', 'Other'] as const

function PaidForm({ invoice }: { invoice: InvoiceDetailData }) {
  const markPaid = useMarkInvoicePaid()
  const [choice, setChoice] = useState<(typeof METHODS)[number]>('GCash')
  const [other, setOther] = useState('')
  const [reference, setReference] = useState('')
  function submit(event: FormEvent) {
    event.preventDefault()
    markPaid.mutate({ invoiceId: invoice.invoice_id, method: choice === 'Other' ? other.trim() : choice, reference })
  }
  return (
    <form className="invoice-payment no-print" onSubmit={submit}>
      <h4 className="invoice-section-title">Record payment</h4>
      <div className="invoice-payment-fields">
        <div className="field">
          <label htmlFor="invoice-method">Payment method</label>
          <select id="invoice-method" value={choice} onChange={(e) => setChoice(e.target.value as (typeof METHODS)[number])}>
            {METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
          </select>
        </div>
        {choice === 'Other' && (
          <div className="field">
            <label htmlFor="invoice-method-other">Other method name</label>
            <input id="invoice-method-other" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Cash, check…" />
          </div>
        )}
        <div className="field">
          <label htmlFor="invoice-reference">Reference</label>
          <input id="invoice-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
      </div>
      <div><button type="submit" className="btn" disabled={markPaid.isPending}>Mark as paid</button></div>
      {markPaid.error && <p className="form-error" role="alert">{markPaid.error.message}</p>}
    </form>
  )
}

function DraftActions({ invoice }: { invoice: InvoiceDetailData }) {
  const markSent = useMarkInvoiceSent()
  return (
    <>
      <button type="button" className="btn" disabled={markSent.isPending} onClick={() => markSent.mutate(invoice.invoice_id)}>
        Mark as sent
      </button>
      {markSent.error && <p className="form-error" role="alert">{markSent.error.message}</p>}
    </>
  )
}

/**
 * One invoice's breakdown (T14.10): fees, venue-cancellation adjustments and total over every line, then one page of
 * lines (T17.19, 25 at a time); printable. The panel around it (InvoicesPage) owns the heading and Close.
 */
export function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const [page, setPage] = useState(1)
  const detail = useInvoiceDetailPage(invoiceId, page)
  if (detail.isPending) return <p className="muted">Loading invoice…</p>
  if (detail.error) {
    return (
      <div className="alert alert-error">
        <p>Couldn't load invoice.</p>
        <button type="button" className="btn btn-ghost" onClick={() => void detail.refetch()}>Retry</button>
      </div>
    )
  }
  const invoice = detail.data
  const feeLabel = `${invoice.fee_count} booking ${invoice.fee_count === 1 ? 'fee' : 'fees'}`
  const rate = invoice.fee_count > 0 ? invoice.fee_total / invoice.fee_count : 0
  const month = new Date(`${invoice.billing_month.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
  return (
    <article className="stack invoice-print invoice-doc" aria-label={`Invoice ${invoiceNumber(invoice)}`}>
      <header className="invoice-head">
        <div>
          <p className="invoice-brand">Plotline</p>
          <h3>{invoiceNumber(invoice)}</h3>
          <p className="muted">{invoice.name}</p>
        </div>
        <span className="console-row-badges">
          <StatusBadge status={invoice.status} />
          {invoice.overdue && <strong className="form-error">Overdue</strong>}
        </span>
      </header>
      <dl className="invoice-dates">
        <div><dt>Billing month</dt><dd>{month}</dd></div>
        {invoice.sent_at && <div><dt>Sent</dt><dd>{formatDate(invoice.sent_at)}</dd></div>}
        {invoice.due_at && invoice.status !== 'paid' && <div><dt>Due</dt><dd>{formatDate(invoice.due_at)}</dd></div>}
        {invoice.status === 'paid' && (
          <div>
            <dt>Paid</dt>
            <dd>
              {invoice.paid_at ? `${formatDate(invoice.paid_at)} · ` : ''}
              {invoice.paid_method ? `paid by ${invoice.paid_method}${invoice.paid_reference ? ` (${invoice.paid_reference})` : ''}` : 'paid'}
            </dd>
          </div>
        )}
      </dl>
      <table className="invoice-items">
        <caption className="sr-only">Invoice items</caption>
        <thead>
          <tr><th scope="col">Item</th><th scope="col" className="num">Qty</th><th scope="col" className="num">Rate</th><th scope="col" className="num">Amount</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Booking fees<span className="muted small invoice-item-note">{feeLabel} for {month}</span></td>
            <td className="num">{invoice.fee_count}</td>
            <td className="num">{formatMoneyExact(rate)}</td>
            <td className="num">{formatMoneyExact(invoice.fee_total)}</td>
          </tr>
          {invoice.adjustment_total !== 0 && (
            <tr>
              <td>Venue cancellations<span className="muted small invoice-item-note">Fees credited back</span></td>
              <td className="num" /><td className="num" />
              <td className="num">{formatMoneyExact(invoice.adjustment_total)}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr><th scope="row" colSpan={3}>Total</th><td className="num"><strong>{formatMoneyExact(invoice.total)}</strong></td></tr>
        </tfoot>
      </table>
      <details className="invoice-charges">
        <summary>Charges ({invoice.line_total})</summary>
        <table className="invoice-lines">
          <thead>
            <tr><th scope="col">Date</th><th scope="col">Reference</th><th scope="col">Kind</th><th scope="col" className="num">Amount</th></tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.charge_id}>
                <td>{formatDate(line.charged_at)}</td>
                <td><a href={bookingsUrl(invoice.slug)}>{line.reference_code}</a></td>
                <td>{line.kind === 'booking_fee' ? 'Booking fee' : 'Venue cancellation'}</td>
                <td className="num">{formatMoneyExact(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {invoice.line_total > CONSOLE_PAGE_SIZE && <div className="no-print"><Pager label="Invoice lines pages" page={page} total={invoice.line_total} onPage={setPage} /></div>}
      </details>
      <p className="muted small">Statement of amounts; not a tax invoice.</p>
      {invoice.status === 'sent' && <PaidForm invoice={invoice} />}
      <div className="form-actions no-print">
        {invoice.status === 'draft' && <DraftActions invoice={invoice} />}
        <button type="button" className="btn btn-ghost" onClick={() => window.print()}>Print</button>
      </div>
    </article>
  )
}
