// The Refund card in the booking panel (T30.6, SPEC §4): each refund the database recorded for the booking, owed until
// staff mark it refunded (method, date, amount) or not refunded (a reason the player sees). A record only: no money
// moves through the app.
import { useState, type FormEvent } from 'react'
import { formatMoney } from '../../lib/format'
import { formatDateLabel } from '../../lib/time'
import { bookingErrorMessage } from '../booking/errors'
import { METHOD_LABELS, paymentLabel } from '../booking/proofInput'
import type { AdminPayment, AdminRefund, UpdateRefundInput } from './api'
import { MAX_REASON, REFUND_METHODS, REFUND_STATUS_LABELS, validateNotRefunded, validateSettle, type SettleErrors } from './refunds'

type Props = {
  refunds: AdminRefund[]
  payments: AdminPayment[]
  timeZone: string
  currency: string
  /** The venue's date today, "YYYY-MM-DD": the default refund date and the latest one allowed. */
  today: string
  pending: boolean
  error: unknown
  onUpdate: (input: UpdateRefundInput) => void
}

export function RefundCard({ refunds, payments, timeZone, currency, today, pending, error, onUpdate }: Props) {
  // A failed save is shown in the block that sent it.
  const [lastId, setLastId] = useState<string | null>(null)
  if (refunds.length === 0) return null
  const errorId = refunds.some((r) => r.id === lastId) ? lastId : refunds[0].id
  const update = (input: UpdateRefundInput) => {
    setLastId(input.refundId)
    onUpdate(input)
  }
  return (
    <div className="stack">
      {refunds.map((refund) => {
        const payment = payments.find((p) => p.id === refund.payment_id)
        const title = refunds.length > 1 && payment
          ? `Refund: ${paymentLabel(payment)} · ${formatMoney(payment.amount, currency)}`
          : 'Refund'
        // Keyed by its last change: a saved refund comes back with a new updated_at and opens closed, while a background
        // refetch of the same refund keeps an open form and what was typed.
        return (
          <RefundBlock key={`${refund.id}:${refund.updated_at}`} title={title} refund={refund} paid={payment?.amount ?? refund.amount}
            timeZone={timeZone} currency={currency} today={today} pending={pending} onUpdate={update}
            error={refund.id === errorId ? error : null} />
        )
      })}
    </div>
  )
}

type BlockProps = {
  title: string
  refund: AdminRefund
  paid: number
  timeZone: string
  currency: string
  today: string
  pending: boolean
  error: unknown
  onUpdate: (input: UpdateRefundInput) => void
}

function RefundBlock({ title, refund, paid, timeZone, currency, today, pending, error, onUpdate }: BlockProps) {
  const [open, setOpen] = useState<'settle' | 'not_refunded' | null>(null)
  const money = (n: number) => formatMoney(n, currency)
  const closed = refund.status !== 'owed'

  return (
    <section className="card stack" aria-label={title}>
      <h3>{title}</h3>
      <dl className="facts">
        <div><dt>Paid</dt><dd>{money(paid)}</dd></div>
        <div><dt>Refund</dt><dd>{money(refund.amount)}</dd></div>
        <div><dt>Status</dt><dd><span className={`badge ${BADGE_CLASS[refund.status]}`}>{REFUND_STATUS_LABELS[refund.status]}</span></dd></div>
        {refund.status === 'settled' && refund.method && <div><dt>Refunded by</dt><dd>{METHOD_LABELS[refund.method]}</dd></div>}
        {refund.status === 'settled' && refund.settled_on && <div><dt>Refunded on</dt><dd>{formatDateLabel(refund.settled_on, timeZone)}</dd></div>}
        {refund.status === 'not_refunded' && refund.reason && <div><dt>Reason</dt><dd>{refund.reason}</dd></div>}
        {refund.note && <div><dt>Staff note</dt><dd className="pre-line">{refund.note}</dd></div>}
      </dl>

      {open === 'settle' ? (
        <SettleForm refund={refund} paid={paid} currency={currency} today={today} pending={pending} onUpdate={onUpdate} onCancel={() => setOpen(null)} />
      ) : open === 'not_refunded' ? (
        <NotRefundedForm refund={refund} pending={pending} onUpdate={onUpdate} onCancel={() => setOpen(null)} />
      ) : closed ? (
        <div className="row-actions">
          <button type="button" className="btn btn-small btn-outline" onClick={() => setOpen(refund.status === 'settled' ? 'settle' : 'not_refunded')}>Edit refund</button>
          <button type="button" className="btn btn-small btn-outline" disabled={pending} onClick={() => onUpdate({ refundId: refund.id, status: 'owed' })}>Reopen as owed</button>
        </div>
      ) : (
        <div className="row-actions">
          <button type="button" className="btn btn-small" onClick={() => setOpen('settle')}>Mark refunded</button>
          <button type="button" className="btn btn-small btn-outline" onClick={() => setOpen('not_refunded')}>Not refunded</button>
        </div>
      )}
      {error != null && <div className="alert alert-error" role="alert"><p>{bookingErrorMessage(error)}</p></div>}
    </section>
  )
}

/** The note goes only when it changed (an emptied one is sent as '' so the server clears it). */
function withNote<T extends UpdateRefundInput>(input: T, text: string, seed: string | null): T {
  const note = text.trim()
  return note === (seed ?? '').trim() ? input : { ...input, note }
}

const BADGE_CLASS = { owed: 'review-rejected', settled: 'review-approved', not_refunded: 'review-pending' } as const

const NOTE_LABEL = 'Staff note (not shown to the player)'

type FormProps = { refund: AdminRefund; pending: boolean; onUpdate: (input: UpdateRefundInput) => void; onCancel: () => void }

function SettleForm({ refund, paid, currency, today, pending, onUpdate, onCancel }: FormProps & { paid: number; currency: string; today: string }) {
  const id = `refund-${refund.id}`
  const [amount, setAmount] = useState(String(refund.amount))
  const [method, setMethod] = useState<string>(refund.method ?? '')
  const [settledOn, setSettledOn] = useState(refund.settled_on ?? today)
  const [note, setNote] = useState(refund.note ?? '')
  const [errors, setErrors] = useState<SettleErrors>({})

  function submit(e: FormEvent) {
    e.preventDefault()
    const result = validateSettle({ amount, method, settledOn }, { paid, today, currency })
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    onUpdate(withNote({ refundId: refund.id, status: 'settled', ...result.value }, note, refund.note))
  }

  const invalid = (key: keyof SettleErrors) => (errors[key] ? { 'aria-invalid': true, 'aria-describedby': `${id}-${key}-error` } : {})
  const message = (key: keyof SettleErrors) =>
    errors[key] ? <p id={`${id}-${key}-error`} className="form-error" role="alert">{errors[key]}</p> : null

  return (
    <form className="stack" aria-label="Mark refunded" onSubmit={submit} noValidate>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${id}-amount`}>Amount refunded</label>
          <input id={`${id}-amount`} type="number" inputMode="decimal" min="0.01" max={paid} step="0.01" value={amount}
            onChange={(e) => setAmount(e.target.value)} {...invalid('amount')} />
          {message('amount')}
        </div>
        <div className="field">
          <label htmlFor={`${id}-method`}>Refunded by</label>
          <select id={`${id}-method`} value={method} onChange={(e) => setMethod(e.target.value)} {...invalid('method')}>
            <option value="">Choose…</option>
            {REFUND_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
          </select>
          {message('method')}
        </div>
        <div className="field">
          <label htmlFor={`${id}-date`}>Date refunded</label>
          <input id={`${id}-date`} type="date" max={today} value={settledOn} onChange={(e) => setSettledOn(e.target.value)} {...invalid('settledOn')} />
          {message('settledOn')}
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${id}-note`}>{NOTE_LABEL}</label>
        <textarea id={`${id}-note`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="row-actions">
        <button type="submit" className="btn btn-small" disabled={pending}>Save refund</button>
        <button type="button" className="btn btn-small btn-outline" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function NotRefundedForm({ refund, pending, onUpdate, onCancel }: FormProps) {
  const id = `refund-${refund.id}`
  const [reason, setReason] = useState(refund.reason ?? '')
  const [note, setNote] = useState(refund.note ?? '')
  const [error, setError] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    const result = validateNotRefunded(reason)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    onUpdate(withNote({ refundId: refund.id, status: 'not_refunded', reason: result.value }, note, refund.note))
  }

  return (
    <form className="stack" aria-label="Not refunded" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={`${id}-reason`}>Reason (shown to the player)</label>
        <textarea id={`${id}-reason`} rows={2} maxLength={MAX_REASON} value={reason} onChange={(e) => setReason(e.target.value)}
          aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-reason-error` : undefined} />
        {error && <p id={`${id}-reason-error`} className="form-error" role="alert">{error}</p>}
      </div>
      <div className="field">
        <label htmlFor={`${id}-note`}>{NOTE_LABEL}</label>
        <textarea id={`${id}-note`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="row-actions">
        <button type="submit" className="btn btn-small" disabled={pending}>Save as not refunded</button>
        <button type="button" className="btn btn-small btn-outline" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
