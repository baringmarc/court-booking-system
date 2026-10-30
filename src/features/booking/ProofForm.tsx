import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ErrorMessage } from '../../components/ErrorMessage'
import { formatMoney } from '../../lib/format'
import { usePaymentAccounts } from '../venue/hooks'
import { bookingErrorMessage } from './errors'
import {
  ACCEPTED_PROOF_TYPES,
  ACCOUNT_PREFIX,
  amountMismatch,
  isProofMethod,
  PROOF_METHOD_OPTIONS,
  validateProofInput,
  type ProofErrors,
  type ProofInput,
  type ProofMethod,
} from './proofInput'

/** Exactly one of method and accountId is set. */
export type ProofValues = { method?: ProofMethod; accountId?: string; amount: number; referenceNumber: string; file: File }

type Props = {
  total: number
  currency: string
  pending: boolean
  error: unknown
  onSubmit: (values: ProofValues) => void
}

export function ProofForm({ total, currency, pending, error, onSubmit }: Props) {
  const [input, setInput] = useState<ProofInput>({ method: '', amount: String(total), referenceNumber: '', file: null })
  const [errors, setErrors] = useState<ProofErrors>({})
  const accounts = usePaymentAccounts()

  // Object URLs must be released; the effect only cleans up, it doesn't sync state.
  const previewUrl = useMemo(
    () => (input.file && input.file.type.startsWith('image/') ? URL.createObjectURL(input.file) : null),
    [input.file],
  )
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const next = validateProofInput(input)
    setErrors(next)
    if (Object.keys(next).length > 0 || !input.file) return
    const paidWith = input.method.startsWith(ACCOUNT_PREFIX)
      ? { accountId: input.method.slice(ACCOUNT_PREFIX.length) }
      : isProofMethod(input.method) ? { method: input.method } : null
    if (!paidWith) return
    onSubmit({ ...paidWith, amount: Number(input.amount), referenceNumber: input.referenceNumber, file: input.file })
  }

  const describedBy = (key: keyof ProofInput) => (errors[key] ? `proof-${key}-error` : undefined)
  const errorText = (key: keyof ProofInput) =>
    errors[key] && <p id={`proof-${key}-error`} className="form-error">{errors[key]}</p>

  if (accounts.isPending) return <p className="muted small" role="status">Loading payment options…</p>
  if (accounts.isError) return <ErrorMessage error={accounts.error} onRetry={() => accounts.refetch()} />
  const options = accounts.data.length > 0
    ? accounts.data.map((a) => ({ value: `${ACCOUNT_PREFIX}${a.id}`, label: a.label }))
    : PROOF_METHOD_OPTIONS

  return (
    <form className="stack" onSubmit={handleSubmit} noValidate aria-label="Upload proof of payment">
      <div className="field">
        <label htmlFor="proof-method">Paid with</label>
        <select id="proof-method" value={input.method} aria-invalid={errors.method ? true : undefined}
          aria-describedby={describedBy('method')} onChange={(e) => setInput((i) => ({ ...i, method: e.target.value }))}>
          <option value="">Choose…</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {errorText('method')}
      </div>
      <div className="field">
        <label htmlFor="proof-amount">Amount paid</label>
        <input id="proof-amount" type="number" inputMode="decimal" min={0} step="0.01" value={input.amount}
          aria-invalid={errors.amount ? true : undefined} aria-describedby={describedBy('amount')}
          onChange={(e) => setInput((i) => ({ ...i, amount: e.target.value }))} />
        {errorText('amount')}
        {!errors.amount && amountMismatch(input.amount, total) && (
          <p className="form-warning" role="status">
            This is different from the total of {formatMoney(total, currency)}. You can still submit; staff will check it.
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="proof-reference">Reference number (optional)</label>
        <input id="proof-reference" value={input.referenceNumber} aria-invalid={errors.referenceNumber ? true : undefined}
          aria-describedby={describedBy('referenceNumber')}
          onChange={(e) => setInput((i) => ({ ...i, referenceNumber: e.target.value }))} />
        {errorText('referenceNumber')}
      </div>
      <div className="field">
        <label htmlFor="proof-file">Receipt screenshot or PDF (max 5 MB)</label>
        <input id="proof-file" type="file" accept={ACCEPTED_PROOF_TYPES.join(',')}
          aria-invalid={errors.file ? true : undefined} aria-describedby={describedBy('file')}
          onChange={(e) => setInput((i) => ({ ...i, file: e.target.files?.[0] ?? null }))} />
        {errorText('file')}
        {previewUrl && <img className="proof-preview" src={previewUrl} alt="Preview of your receipt" />}
        {input.file && !previewUrl && <p className="muted small">{input.file.name}</p>}
      </div>
      {error != null && (
        <div className="alert alert-error" role="alert"><p>{bookingErrorMessage(error)}</p></div>
      )}
      <button type="submit" className="btn btn-block" disabled={pending}>
        {pending && <span className="spinner spinner-inline" aria-hidden="true" />}
        {pending ? 'Uploading…' : 'Submit proof of payment'}
      </button>
    </form>
  )
}
