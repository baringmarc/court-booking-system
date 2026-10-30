import { useEffect, useRef, useState } from 'react'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PhotoViewer } from '../../components/PhotoViewer'
import { qrDownloadUrl, qrImageUrl, type PaymentAccount } from '../venue/api'
import { usePaymentAccounts } from '../venue/hooks'

/** The venue's payment accounts while a player pays (T11.11): one card each, with the QR code when there is one. */
export function PaymentAccountList() {
  const accounts = usePaymentAccounts()
  if (accounts.isPending) return <p className="muted small" role="status">Loading payment options…</p>
  if (accounts.isError) return <ErrorMessage error={accounts.error} onRetry={() => accounts.refetch()} />
  if (accounts.data.length === 0) return null
  return (
    <ul className="payment-accounts" aria-label="Payment accounts">
      {accounts.data.map((a) => <li key={a.id}><AccountCard account={a} /></li>)}
    </ul>
  )
}

function AccountCard({ account }: { account: PaymentAccount }) {
  const [viewing, setViewing] = useState(false)
  const [qrFailed, setQrFailed] = useState<string | null>(null)
  const qr = account.qr_path && qrFailed !== account.qr_path ? account.qr_path : null
  const alt = `QR code for ${account.label}`

  return (
    <article className="payment-account" aria-labelledby={`account-${account.id}`}>
      <p className="account-label" id={`account-${account.id}`}><strong>{account.label}</strong></p>
      {account.account_name && <p className="account-name">{account.account_name}</p>}
      {account.account_number && <CopyNumber label={account.label} number={account.account_number} />}
      {qr && (
        <>
          <button type="button" className="qr-open" aria-label={`Show the ${account.label} QR code full size`} onClick={() => setViewing(true)}>
            <img src={qrImageUrl(qr)} alt={alt} width={220} height={220} loading="lazy" onError={() => setQrFailed(qr)} />
          </button>
          <div className="qr-actions">
            <a className="btn btn-small btn-outline tap-44" href={qrDownloadUrl(qr, account.label)}>Download QR</a>
            <IphoneHint />
          </div>
        </>
      )}
      {viewing && qr && (
        <PhotoViewer photos={[{ src: qrImageUrl(qr), alt }]} start={0} label={`${account.label} QR code`} onClose={() => setViewing(false)} />
      )}
    </article>
  )
}

/** A toggletip (T11.25): opens on tap or click, never on hover; Escape, the button again or a tap outside closes it. */
function IphoneHint() {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <span className="toggletip" ref={wrap}>
      <button ref={button} type="button" className="toggletip-button tap-44" aria-label="How to save to Photos on iPhone" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">ⓘ</span>
      </button>
      {open && (
        <p className="toggletip-bubble small">On iPhone, a download goes to Files. To scan it from Photos instead, tap the QR code to open it, then press and hold it and choose Save to Photos.</p>
      )}
    </span>
  )
}

function CopyNumber({ label, number }: { label: string; number: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  async function copy() {
    try {
      await navigator.clipboard.writeText(number)
      setState('copied')
    } catch {
      setState('failed')
    }
    // Back to "Copy", so copying again is announced again.
    window.setTimeout(() => setState('idle'), 3000)
  }
  return (
    <p className="account-number">
      <span className="account-number-value">{number}</span>
      <button type="button" className="btn btn-small tap-44" aria-label={`Copy the ${label} number`} onClick={copy}>
        {state === 'copied' ? 'Copied' : 'Copy'}
      </button>
      <span className="sr-only" role="status">
        {state === 'copied' ? `${label} number copied` : state === 'failed' ? `Couldn't copy. Select the number to copy it.` : ''}
      </span>
      {state === 'failed' && <span className="small muted" aria-hidden="true">Couldn't copy. Select the number instead.</span>}
    </p>
  )
}
