import { useEffect, useRef, useState } from 'react'
import { QrCode, X } from 'lucide-react'
import { bookingQrFileName } from './bookingQr'
import type { BookingQr } from './useBookingQr'

const NOTE = 'Share your booking site'

type Props = { qr: BookingQr; address: string; slug: string; venueName: string }

function save(qr: BookingQr, slug: string) {
  if (qr.status !== 'ready') return
  const link = document.createElement('a')
  link.href = qr.url
  link.download = bookingQrFileName(slug)
  document.body.append(link)
  link.click()
  link.remove()
}

/** The QR, the note and Save (T34.1): the end of the admin sidebar and of the phone menu drawer, and the dialog's body. */
export function BookingQrCard({ qr, address, slug, venueName, large = false }: Props & { large?: boolean }) {
  const size = large ? 280 : 160
  return (
    <div className={`booking-qr${large ? ' booking-qr-large' : ''}`}>
      {qr.status === 'ready' ? (
        <img src={qr.url} alt={`QR code for ${venueName}'s booking site`} width={size} height={size} />
      ) : qr.status === 'drawing' ? (
        <span className="booking-qr-placeholder" style={{ width: size, height: size }} aria-hidden="true" />
      ) : null}
      <p className="booking-qr-note">{NOTE}</p>
      {qr.status === 'failed' && <p className="booking-qr-link">{address}</p>}
      <button type="button" className="btn btn-small btn-outline" disabled={qr.status !== 'ready'} onClick={() => save(qr, slug)}>
        Save
      </button>
    </div>
  )
}

/** The collapsed sidebar's QR icon (T34.1): opens a small modal dialog with a larger code; the sidebar stays collapsed. */
export function BookingQrButton(props: Props) {
  const [open, setOpen] = useState(false)
  const icon = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={icon} type="button" className="btn btn-small btn-ghost booking-qr-icon" aria-label={NOTE} title={NOTE}
        onClick={() => setOpen(true)}>
        <QrCode size={20} aria-hidden="true" />
      </button>
      {open && <BookingQrDialog {...props} onClose={() => { setOpen(false); icon.current?.focus() }} />}
    </>
  )
}

function BookingQrDialog({ onClose, ...props }: Props & { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  return (
    // A click on the backdrop lands on the <dialog> itself (its content is inside .dialog-body): close then.
    <dialog ref={ref} className="dialog booking-qr-dialog" aria-label={NOTE} onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close() }}>
      <div className="dialog-body">
        <button type="button" className="btn btn-outline icon-btn booking-qr-close" aria-label="Close" onClick={() => ref.current?.close()}>
          <X size={18} aria-hidden="true" />
        </button>
        <BookingQrCard {...props} large />
      </div>
    </dialog>
  )
}
