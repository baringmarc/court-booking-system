import { formatMoneyExact } from '../../lib/format'
import { useInvoicesPage } from './hooks'
import { InvoiceDetail } from './InvoiceDetail'
import { invoiceNumber } from './invoiceNumber'
import { DetailsButton, ListStatus, RecordPanel, SearchField, StatusBadge, StatusFilter } from './ListControls'
import { focusDetails, useListParams } from './listParams'
import { Pager } from './Pager'

const INVOICE_STATUSES = ['draft', 'sent', 'paid'] as const
const FILTER_OPTIONS = [['', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['paid', 'Paid']] as const

/** The console's Invoices page (T14.10, routed and paged in T17.19): search, status and billing-month filters. */
export function InvoicesPage() {
  const { state, setFilter, setPage, setOpen } = useListParams(INVOICE_STATUSES)
  const invoices = useInvoicesPage({ search: state.q, status: state.status, month: state.month, page: state.page })
  const rows = invoices.data?.rows ?? []
  const open = rows.find((invoice) => invoice.invoice_id === state.open)
  const filtered = state.status !== '' || state.month !== '' || state.q !== ''

  return (
    <div className="stack console-page">
      <h1>Invoices</h1>
      <div className="console-filters">
        <SearchField id="invoice-search" label="Search invoices" value={state.q} onSearch={(q) => setFilter({ q })} />
        <StatusFilter id="invoice-filter" value={state.status} options={FILTER_OPTIONS} onChange={(status) => setFilter({ status })} />
        <div className="field">
          <label htmlFor="invoice-month">Billing month</label>
          <input id="invoice-month" type="month" value={state.month.slice(0, 7)}
            onChange={(e) => setFilter({ month: /^\d{4}-\d{2}$/.test(e.target.value) ? `${e.target.value}-01` : '' })} />
        </div>
      </div>
      <ListStatus noun="invoices" pending={invoices.isPending} error={invoices.error} onRetry={() => void invoices.refetch()}
        empty={invoices.isSuccess && invoices.data.total === 0} filtered={filtered ? 'No invoices match these filters.' : 'No invoices yet.'} />
      {invoices.data && invoices.data.total > 0 && (
        <div className={`console-records${open ? ' has-panel' : ''}`}>
          <div className="stack">
            <ul className="list console-rows">
              {rows.map((invoice) => (
                <li key={invoice.invoice_id} className="card console-row">
                  <div className="console-row-main">
                    <strong>{invoice.name}</strong>
                    <span className="muted small">{invoiceNumber(invoice)} · <span>{formatMoneyExact(invoice.total)}</span></span>
                  </div>
                  <span className="console-row-badges">
                    <StatusBadge status={invoice.status} />
                    {invoice.overdue && <strong className="form-error">Overdue</strong>}
                  </span>
                  <DetailsButton id={invoice.invoice_id} name={`${invoiceNumber(invoice)} ${invoice.name}`} onOpen={() => setOpen(invoice.invoice_id)} />
                </li>
              ))}
            </ul>
            <Pager label="Invoices pages" page={state.page} total={invoices.data.total} onPage={setPage} />
          </div>
          {open && (
            <RecordPanel key={open.invoice_id} label={`Invoice ${invoiceNumber(open)}`} title={`${invoiceNumber(open)} · ${open.name}`}
              onClose={() => { setOpen(null); focusDetails(open.invoice_id) }}>
              <InvoiceDetail invoiceId={open.invoice_id} />
            </RecordPanel>
          )}
        </div>
      )}
    </div>
  )
}
