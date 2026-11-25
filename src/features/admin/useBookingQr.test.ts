// T34.1: the hook waits while the logo is unknown (settings loading) and draws a plain code once it is known to be
// none (settings loaded without a logo, or settings failed: AdminLayout passes null then).
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderBookingQr } from './bookingQr'
import { useBookingQr } from './useBookingQr'

vi.mock('./bookingQr', () => ({ renderBookingQr: vi.fn() }))

beforeEach(() => {
  vi.mocked(renderBookingQr).mockReset().mockResolvedValue(new Blob([], { type: 'image/png' }))
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:qr'), revokeObjectURL: vi.fn() }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useBookingQr', () => {
  it('draws nothing while the logo is unknown', () => {
    const { result } = renderHook(() => useBookingQr('https://a.plotline.fit/book', undefined))
    expect(result.current).toEqual({ status: 'drawing' })
    expect(renderBookingQr).not.toHaveBeenCalled()
  })

  it('draws a plain code when there is no logo', async () => {
    const { result } = renderHook(() => useBookingQr('https://a.plotline.fit/book', null))
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', url: 'blob:qr' }))
    expect(renderBookingQr).toHaveBeenCalledWith('https://a.plotline.fit/book', null)
  })

  it('reports a failed drawing', async () => {
    vi.mocked(renderBookingQr).mockRejectedValue(new Error("This browser can't draw the QR code."))
    const { result } = renderHook(() => useBookingQr('https://a.plotline.fit/book', null))
    await waitFor(() => expect(result.current).toEqual({ status: 'failed' }))
  })
})
