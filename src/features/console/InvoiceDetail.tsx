import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../lib/queryClient'
import { formatMoneyExact } from '../../lib/format'
import { venueAdminUrl } from '../../lib/venueUrl'
import { CONSOLE_PAGE_SIZE, type InvoiceDetailData } from './api'
import { ConsoleDialog } from './ConsoleDialog'
import { useInvoiceDetailPage, useMarkInvoicePaid, useMarkInvoiceSent, usePreviewInvoicePdf, useSendInvoice } from './hooks'
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

function MarkSentButton({ invoice, disabled }: { invoice: InvoiceDetailData; disabled: boolean }) {
  const markSent = useMarkInvoiceSent()
  return (
    <>
      <button type="button" className="btn btn-outline" disabled={disabled || markSent.isPending} onClick={() => markSent.mutate(invoice.invoice_id)}>
        Mark as sent
      </button>
      {markSent.error && <p className="form-error" role="alert">{markSent.error.message}</p>}
    </>
  )
}

/** "Emailed to owners on <date>", with the count when it went out more than once (T26.6). */
function EmailedLine({ invoice }: { invoice: InvoiceDetailData }) {
  if (!invoice.last_emailed_at || !invoice.email_count) return null
  const times = invoice.email_count > 1 ? ` (${invoice.email_count} times)` : ''
  return <p className="muted small invoice-emailed">Emailed to owners on {formatDate(invoice.last_emailed_at)}{times}</p>
}

/** Opens the PDF in a new tab. The tab opens on the click, before the fetch, so popup blockers allow it. */
function usePdfPreview(invoiceId: string) {
  const preview = usePreviewInvoicePdf()
  function open() {
    const tab = window.open('', '_blank')
    preview.mutate(invoiceId, {
      onSuccess: (blob) => {
        const url = URL.createObjectURL(blob)
        if (tab && !tab.closed) tab.location.href = url
        else window.open(url, '_blank')
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      },
      onError: () => tab?.close(),
    })
  }
  return { open, isPending: preview.isPending, error: preview.error }
}

/**
 * Send invoice (draft) and Resend invoice (sent) through the invoice-pdf function (T26.6), after a confirmation naming
 * the venue's owners; the console can't read their emails, so the result lists the ones the function used.
 */
function SendControl({ invoice, onConfirmOpen }: { invoice: InvoiceDetailData; onConfirmOpen: (open: boolean) => void }) {
  const send = useSendInvoice()
  const [confirming, setConfirming] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const label = invoice.status === 'draft' ? 'Send invoice' : 'Resend invoice'
  const number = invoiceNumber(invoice)
  function close() {
    setConfirming(false)
    onConfirmOpen(false)
    opener.current?.focus()
  }
  return (
    <>
      <button type="button" ref={opener} className="btn" disabled={send.isPending}
        onClick={() => { send.reset(); setConfirming(true); onConfirmOpen(true) }}>
        {label}
      </button>
      {confirming && (
        <ConsoleDialog id="invoice-send" title={label} onCancel={() => { if (!send.isPending) close() }}>
          <p>Email invoice {number} to every owner of {invoice.name}?</p>
          <p className="muted small">The PDF goes to the owners' sign-in emails.{invoice.status === 'draft' ? ' The invoice is marked sent.' : ''}</p>
          <div className="form-actions">
            <button type="button" className="btn" disabled={send.isPending} autoFocus
              onClick={() => send.mutate(invoice.invoice_id, { onSettled: close })}>
              {send.isPending ? 'Sending…' : label}
            </button>
            <button type="button" className="btn btn-ghost" disabled={send.isPending} onClick={close}>Cancel</button>
          </div>
        </ConsoleDialog>
      )}
      {send.data && (
        <p className="invoice-send-result" role="status">
          Sent to {send.data.recipients.join(', ')}
        </p>
      )}
      {send.error && (
        <p className="form-error invoice-send-result" role="alert">
          {send.error.message}
          {send.error instanceof ApiError && send.error.hint === 'billing_details_missing' && <> <Link to="/billing">Billing</Link></>}
        </p>
      )}
    </>
  )
}

function InvoiceActions({ invoice }: { invoice: InvoiceDetailData }) {
  const pdf = usePdfPreview(invoice.invoice_id)
  const [confirmOpen, setConfirmOpen] = useState(false)
  return (
    <div className="form-actions no-print invoice-actions">
      {invoice.status !== 'paid' && <SendControl invoice={invoice} onConfirmOpen={setConfirmOpen} />}
      {invoice.status === 'draft' && <MarkSentButton invoice={invoice} disabled={confirmOpen} />}
      <button type="button" className="btn btn-outline" disabled={pdf.isPending} onClick={pdf.open}>
        {pdf.isPending ? 'Preparing PDF…' : 'Preview PDF'}
      </button>
      <button type="button" className="btn btn-ghost" onClick={() => window.print()}>Print</button>
      {pdf.error && <p className="form-error" role="alert">{pdf.error.message}</p>}
    </div>
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
          <EmailedLine invoice={invoice} />
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
      <InvoiceActions invoice={invoice} />
    </article>
  )
}
