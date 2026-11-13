import { useEffect, useRef, useState, type FormEvent } from 'react'
import { errorMessage } from '../../lib/errors'
import { qrImageUrl, type PaymentAccount } from '../venue/api'
import type { QrChange } from './api'
import { checkQrFile, prepareQrImage } from './qrImage'
import { useSettingsDirty } from './settingsDraft'

const LABEL_MAX = 40
const NAME_MAX = 80
const NUMBER_MAX = 60

type Draft = { kind: 'none' } | { kind: 'file'; file: File; preview: string } | { kind: 'clear' }

/** The add and edit form for one payment account, shared with the console's Billing page (T26.5). */
export function AccountForm({ initial, label, dirtyKey, saving, error, onSave, onCancel, qrSrc }: {
  initial: PaymentAccount | null
  label: string
  dirtyKey: string
  saving: boolean
  error: Error | null
  onSave: (input: { label: string; account_name: string; account_number: string }, qr: QrChange) => void
  onCancel?: () => void
  /** The saved QR's image URL; defaults to the public payment-qr bucket's. A private bucket passes a signed URL (null until it loads). */
  qrSrc?: string | null
}) {
  const setDirty = useSettingsDirty(dirtyKey)
  const [name, setName] = useState(initial?.label ?? '')
  const [accountName, setAccountName] = useState(initial?.account_name ?? '')
  const [accountNumber, setAccountNumber] = useState(initial?.account_number ?? '')
  const [draft, setDraft] = useState<Draft>({ kind: 'none' })
  const [fileError, setFileError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const preview = draft.kind === 'file' ? draft.preview : null
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const shownQr = draft.kind === 'file' ? draft.preview : draft.kind === 'clear' || !initial?.qr_path ? null : qrSrc !== undefined ? qrSrc : qrImageUrl(initial.qr_path)
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
          <input required maxLength={LABEL_MAX} value={name} onChange={(e) => { setName(e.target.value); setDirty(true) }} />
        </label>
        <label className="field">
          <span>Account name</span>
          <input maxLength={NAME_MAX} value={accountName} onChange={(e) => { setAccountName(e.target.value); setDirty(true) }} />
        </label>
        <label className="field">
          <span>Account or mobile number</span>
          <input maxLength={NUMBER_MAX} value={accountNumber} onChange={(e) => { setAccountNumber(e.target.value); setDirty(true) }} />
        </label>
      </div>
      <div className="field">
        <label htmlFor={fileId}>QR code <span className="muted small">(optional; a screenshot of the code works)</span></label>
        <input id={fileId} type="file" accept="image/png,image/jpeg,image/webp"
          aria-invalid={fileError ? true : undefined} aria-describedby={fileError ? `${fileId}-error` : undefined}
          onChange={(e) => {
            chooseFile(e.target.files?.[0])
            setDirty(true)
            e.target.value = '' // so picking the same file again still counts
          }} ref={fileInput} />
        {fileError && <p id={`${fileId}-error`} className="form-error" role="alert">{fileError}</p>}
      </div>
      {shownQr && (
        <div className="qr-admin-preview">
          <img src={shownQr} alt={`QR code for ${name.trim() || 'this account'}`} width={160} height={160} />
          <button type="button" className="btn btn-small btn-ghost" onClick={() => {
            setDraft({ kind: initial?.qr_path ? 'clear' : 'none' })
            setDirty(true)
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
