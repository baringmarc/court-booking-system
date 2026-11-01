import { useState, type FormEvent } from 'react'
import { formatMoneyExact } from '../../lib/format'
import { venueAdminUrl } from '../../lib/venueUrl'
import type { InvoiceDetailData } from './api'
import { useInvoiceDetail, useMarkInvoicePaid, useMarkInvoiceSent } from './hooks'
import { invoiceNumber } from './invoiceNumber'

/** Where a venue's bookings list lives, from the console's host. */
function bookingsUrl(slug: string): string {
  const url = new URL(venueAdminUrl(slug, window.location), window.location.origin)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/bookings`
  return url.toString()
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
}

function PaidForm({ invoice }: { invoice: InvoiceDetailData }) {
  const markPaid = useMarkInvoicePaid()
  const [method, setMethod] = useState('')
  const [reference, setReference] = useState('')
  function submit(event: FormEvent) {
    event.preventDefault()
    markPaid.mutate({ invoiceId: invoice.invoice_id, method, reference })
  }
  return (
    <form className="stack no-print" onSubmit={submit}>
      <label>
        Payment method
        <input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="GCash, bank transfer…" />
      </label>
      <label>
        Reference
        <input value={reference} onChange={(e) => setReference(e.target.value)} />
      </label>
      <button type="submit" className="btn" disabled={markPaid.isPending}>Mark as paid</button>
      {markPaid.error && <p className="form-error" role="alert">{markPaid.error.message}</p>}
    </form>
  )
}

function DraftActions({ invoice }: { invoice: InvoiceDetailData }) {
  const markSent = useMarkInvoiceSent()
  return (
    <div className="stack no-print">
      <button type="button" className="btn" disabled={markSent.isPending} onClick={() => markSent.mutate(invoice.invoice_id)}>
        Mark as sent
      </button>
      {markSent.error && <p className="form-error" role="alert">{markSent.error.message}</p>}
    </div>
  )
}

/** One invoice's breakdown (T14.10): fees, venue-cancellation adjustments, total and every line; printable. */
export function InvoiceDetail({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const detail = useInvoiceDetail(invoiceId)
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
  return (
    <article className="card stack invoice-print" aria-label={`Invoice ${invoiceNumber(invoice)}`}>
      <h3>Plotline · {invoiceNumber(invoice)}</h3>
      <p>{invoice.name}</p>
      <p className="muted">
        {invoice.billing_month.slice(0, 7)} · {invoice.status}
        {invoice.overdue && <> · <strong className="form-error">Overdue</strong></>}
        {invoice.due_at && invoice.status !== 'paid' && <> · due {formatDate(invoice.due_at)}</>}
        {invoice.status === 'paid' && invoice.paid_method && <> · paid by {invoice.paid_method}{invoice.paid_reference ? ` (${invoice.paid_reference})` : ''}</>}
      </p>
      <dl className="stack">
        <div><dt>{feeLabel}</dt><dd>{formatMoneyExact(invoice.fee_total)}</dd></div>
        <div><dt>Venue cancellations</dt><dd>{formatMoneyExact(invoice.adjustment_total)}</dd></div>
        <div><dt><strong>Total</strong></dt><dd><strong>{formatMoneyExact(invoice.total)}</strong></dd></div>
      </dl>
      <ul className="list">
        {invoice.lines.map((line) => (
          <li key={line.charge_id}>
            {formatDate(line.charged_at)} · <a href={bookingsUrl(invoice.slug)}>{line.reference_code}</a> ·{' '}
            {line.kind === 'booking_fee' ? 'Booking fee' : 'Venue cancellation'} · {formatMoneyExact(line.amount)}
          </li>
        ))}
      </ul>
      {invoice.status === 'draft' && <DraftActions invoice={invoice} />}
      {invoice.status === 'sent' && <PaidForm invoice={invoice} />}
      <p className="muted">Statement of amounts; not a tax invoice.</p>
      <div className="form-actions no-print">
        <button type="button" className="btn btn-ghost" onClick={() => window.print()}>Print</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </article>
  )
}
