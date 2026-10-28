import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { errorMessage } from '../../lib/errors'
import { qrImageUrl, type PaymentAccount } from '../venue/api'
import { usePaymentAccounts } from '../venue/hooks'
import type { QrChange } from './api'
import { useDeletePaymentAccount, useReorderPaymentAccounts, useSavePaymentAccount } from './hooks'
import { checkQrFile, prepareQrImage } from './qrImage'
import { SortableList } from './SortableList'

export const PAYMENT_ACCOUNTS_MAX = 10
const LABEL_MAX = 40
const NAME_MAX = 80
const NUMBER_MAX = 60

/** Payment accounts with optional QR codes (T11.11): add, edit, delete and reorder. Players see them while paying. */
export function PaymentAccountsSection() {
  const accounts = usePaymentAccounts()
  const save = useSavePaymentAccount()
  const add = useSavePaymentAccount() // its own, so an open edit form never shows the add form's state
  const remove = useDeletePaymentAccount()
  const move = useReorderPaymentAccounts()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addKey, setAddKey] = useState(0) // bumped after adding, so the add form empties

  function startEdit(id: string | null) {
    save.reset()
    setEditingId(id)
  }

  function handleDelete(account: PaymentAccount) {
    if (window.confirm(`Delete ${account.label}? Players will no longer see it.`)) remove.mutate(account)
  }

  return (
    <section className="card stack" aria-labelledby="payment-accounts-heading">
      <h2 id="payment-accounts-heading">Payment accounts</h2>
      <p className="muted small">
        Where players send their payment, shown above the payment instructions in this order. Add a QR code so they can
        scan it in GCash, Maya or their bank app.
      </p>
      {accounts.isPending ? (
        <PageLoader />
      ) : accounts.isError ? (
        <ErrorMessage error={accounts.error} onRetry={() => accounts.refetch()} />
      ) : (
        <>
          {accounts.data.length === 0 ? (
            <p className="muted">No payment accounts yet. Players see only the payment instructions.</p>
          ) : (
            <SortableList
              className="list order-list"
              label="Payment accounts in order"
              items={accounts.data}
              disabled={editingId !== null}
              onReorder={(ids) => move.mutate(ids)}
              renderItem={(a) => editingId === a.id ? (
                <AccountForm key={a.id} initial={a} label={`Edit ${a.label}`} saving={save.isPending} error={save.error}
                  onCancel={() => startEdit(null)}
                  onSave={(input, qr) => save.mutate({ existing: a, input, qr }, { onSuccess: () => setEditingId(null) })} />
              ) : (
                <span className="list-row">
                  <span className="account-summary">
                    <strong>{a.label}</strong>
                    <span className="muted small">{[a.account_name, a.account_number].filter(Boolean).join(' · ') || 'No account details'}</span>
                    {a.qr_path && <span className="badge">QR</span>}
                  </span>
                  <span className="list-row-end">
                    <button type="button" className="btn btn-small btn-outline" aria-label={`Edit ${a.label}`}
                      onClick={() => startEdit(a.id)}>Edit</button>
                    <button type="button" className="btn btn-small btn-ghost" aria-label={`Delete ${a.label}`}
                      disabled={remove.isPending} onClick={() => handleDelete(a)}>Delete</button>
                  </span>
                </span>
              )}
            />
          )}
          {(remove.error || move.error) && <p className="form-error" role="alert">{errorMessage(remove.error ?? move.error)}</p>}
          <h3>Add an account</h3>
          {accounts.data.length >= PAYMENT_ACCOUNTS_MAX ? (
            <p className="muted">You can list up to {PAYMENT_ACCOUNTS_MAX} accounts. Delete one to add another.</p>
          ) : (
            <AccountForm key={addKey} initial={null} label="New payment account" saving={add.isPending} error={add.error}
              onSave={(input, qr) => add.mutate({ existing: null, input, qr }, { onSuccess: () => { add.reset(); setAddKey((k) => k + 1) } })} />
          )}
        </>
      )}
    </section>
  )
}

type Draft = { kind: 'none' } | { kind: 'file'; file: File; preview: string } | { kind: 'clear' }

function AccountForm({ initial, label, saving, error, onSave, onCancel }: {
  initial: PaymentAccount | null
  label: string
  saving: boolean
  error: Error | null
  onSave: (input: { label: string; account_name: string; account_number: string }, qr: QrChange) => void
  onCancel?: () => void
}) {
  const [name, setName] = useState(initial?.label ?? '')
  const [accountName, setAccountName] = useState(initial?.account_name ?? '')
  const [accountNumber, setAccountNumber] = useState(initial?.account_number ?? '')
  const [draft, setDraft] = useState<Draft>({ kind: 'none' })
  const [fileError, setFileError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const preview = draft.kind === 'file' ? draft.preview : null
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const shownQr = draft.kind === 'file' ? draft.preview : draft.kind === 'clear' || !initial?.qr_path ? null : qrImageUrl(initial.qr_path)
  const fileId = `${label.replace(/\W+/g, '-')}-qr`

  function chooseFile(file: File | undefined) {
    setFileError(null)
    if (!file) return
    const problem = checkQrFile(file)
    if (problem) {
      setFileError(problem)
      return
    }
    setDraft({ kind: 'file', file, preview: URL.createObjectURL(file) })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    let qr: QrChange = { kind: 'keep' }
    if (draft.kind === 'clear') qr = { kind: 'clear' }
    if (draft.kind === 'file') {
      setPreparing(true)
      try {
        qr = { kind: 'set', image: await prepareQrImage(draft.file) }
      } catch (err) {
        setFileError(errorMessage(err))
        return
      } finally {
        setPreparing(false)
      }
    }
    onSave({ label: name.trim(), account_name: accountName.trim(), account_number: accountNumber.trim() }, qr)
  }

  const busy = saving || preparing
  return (
    <form className="stack payment-account-form" aria-label={label} onSubmit={handleSubmit}>
      <div className="form-grid">
        <label className="field">
          <span>Label <span className="muted small">(e.g. GCash, Maya, BPI)</span></span>
          <input required maxLength={LABEL_MAX} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Account name</span>
          <input maxLength={NAME_MAX} value={accountName} onChange={(e) => setAccountName(e.target.value)} />
        </label>
        <label className="field">
          <span>Account or mobile number</span>
          <input maxLength={NUMBER_MAX} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
        </label>
      </div>
      <div className="field">
        <label htmlFor={fileId}>QR code <span className="muted small">(optional; a screenshot of the code works)</span></label>
        <input id={fileId} type="file" accept="image/png,image/jpeg,image/webp"
          aria-invalid={fileError ? true : undefined} aria-describedby={fileError ? `${fileId}-error` : undefined}
          onChange={(e) => {
            chooseFile(e.target.files?.[0])
            e.target.value = '' // so picking the same file again still counts
          }} ref={fileInput} />
        {fileError && <p id={`${fileId}-error`} className="form-error" role="alert">{fileError}</p>}
      </div>
      {shownQr && (
        <div className="qr-admin-preview">
          <img src={shownQr} alt={`QR code for ${name.trim() || 'this account'}`} width={160} height={160} />
          <button type="button" className="btn btn-small btn-ghost" onClick={() => {
            setDraft({ kind: initial?.qr_path ? 'clear' : 'none' })
            fileInput.current?.focus() // this button goes away with the preview
          }}>
            Remove QR code
          </button>
        </div>
      )}
      {draft.kind === 'clear' && <p className="muted small">The QR code will be removed when you save.</p>}
      <div className="form-actions">
        <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save account' : 'Add account'}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
        {error && <span className="form-error" role="alert">{errorMessage(error)}</span>}
      </div>
    </form>
  )
}
