import { useState } from 'react'
import { formatMoneyExact } from '../../lib/format'
import { InvoiceDetail } from './InvoiceDetail'
import { useInvoices } from './hooks'
import { invoiceNumber } from './invoiceNumber'

/** The console's invoices (T14.10): newest month first, with the overdue flag; Review opens the breakdown. */
export function InvoicesList() {
  const invoices = useInvoices()
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <section className="stack" aria-labelledby="invoices-heading">
      <h2 id="invoices-heading">Invoices</h2>
      {invoices.isPending ? (
        <p className="muted">Loading invoices…</p>
      ) : invoices.error ? (
        <div className="alert alert-error">
          <p>Couldn't load invoices.</p>
          <button type="button" className="btn btn-ghost" onClick={() => void invoices.refetch()}>Retry</button>
        </div>
      ) : invoices.data.length === 0 ? (
        <p className="muted">No invoices yet.</p>
      ) : (
        <ul className="list">
          {invoices.data.map((invoice) => (
            <li key={invoice.invoice_id} className="card stack">
              <strong>{invoiceNumber(invoice)}</strong>
              <p>{invoice.name}</p>
              <p className="muted">
                {invoice.status} · {formatMoneyExact(invoice.total)}
                {invoice.overdue && <> · <strong className="form-error">Overdue</strong></>}
              </p>
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setOpenId(invoice.invoice_id)}>Review</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {openId && <InvoiceDetail key={openId} invoiceId={openId} onClose={() => setOpenId(null)} />}
    </section>
  )
}
