import { useEffect, useState } from 'react'
import { renderBookingQr } from './bookingQr'

export type BookingQr = { status: 'drawing' } | { status: 'ready'; url: string } | { status: 'failed' }

type Drawn = { key: string; url: string | null }

/**
 * The booking-site QR code as an object URL (T34.1), drawn once per address and logo. `logoUrl` undefined means the
 * venue settings haven't loaded yet, so nothing is drawn until it's known. A newer drawing frees the older one, and
 * unmounting frees the last.
 */
export function useBookingQr(address: string, logoUrl: string | null | undefined): BookingQr {
  const key = logoUrl === undefined ? null : `${address}\n${logoUrl ?? ''}`
  const [drawn, setDrawn] = useState<Drawn | null>(null)

  useEffect(() => {
    if (logoUrl === undefined || key === null) return
    let current = true
    let objectUrl: string | null = null
    renderBookingQr(address, logoUrl).then(
      (png) => {
        if (!current) return
        objectUrl = URL.createObjectURL(png)
        setDrawn({ key, url: objectUrl })
      },
      () => { if (current) setDrawn({ key, url: null }) },
    )
    return () => {
      current = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [key, address, logoUrl])

  if (!drawn || drawn.key !== key) return { status: 'drawing' }
  return drawn.url ? { status: 'ready', url: drawn.url } : { status: 'failed' }
}
